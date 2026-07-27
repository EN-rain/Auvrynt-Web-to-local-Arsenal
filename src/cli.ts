#!/usr/bin/env node
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import { chmod, cp, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import * as prompts from "@clack/prompts";
import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { satisfies } from "semver";
import { loadConfig } from "./config.js";
import {
  generateOwnerToken,
  loadAuvryntFiles,
  writeAuvryntAuth,
  writeAuvryntConfig,
  type AuvryntIntegrationsConfig,
  type AuvryntUserConfig,
} from "./user-config.js";
import { expandHomePath } from "./roots.js";
import { discoverLocalIntegrations, processDetected } from "./integration-discovery.js";
import { readConnectedClients } from "./connection-registry.js";
import { ensureGlobalGodotPlugin, getGlobalGodotPluginStatus } from "./godot-tools.js";
import { ensurePlaywrightRuntime, getPlaywrightRuntimeStatus } from "./playwright-runtime.js";
import {
  INTEGRATION_KEYS,
  INTEGRATION_LABELS,
  acquireManagementLock,
  atomicWriteJson,
  getProcessIdentity,
  isProcessRunning,
  parseIntegrationProfiles,
  parseStartRequest,
  processIdentityMatches,
  readJsonFile,
  rotateLogFile,
  type InstanceLockRecord,
  type IntegrationKey,
  type ManagedTunnelRecord,
  type StartRequest,
} from "./background-lifecycle.js";


type Command = "serve" | "init" | "doctor" | "status" | "connected" | "token" | "uninstall" | "config" | "setup" | "enable" | "disable" | "add" | "stop" | "restart" | "help";
const require = createRequire(import.meta.url);
const SUPPORTED_NODE_RANGE = ">=20.12 <27";
const MANAGED_SERENA_PACKAGE = "serena-agent==1.6.0";
const MANAGED_UV_PACKAGE = "uv==0.11.32";
const MANAGED_CLOUDFLARED_VERSION = "2026.7.2";

function httpUrl(host: string, port: number, path = ""): string {
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${formattedHost}:${port}${path}`;
}

function localProbeHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

interface ConsoleRow {
  label: string;
  value: string;
}

function printConsolePanel(title: string, rows: ConsoleRow[] = [], footer?: string): void {
  const labelWidth = rows.reduce((width, row) => Math.max(width, row.label.length), 0);
  console.log(`┌  ${title}`);
  for (const row of rows) {
    console.log(`│  ${row.label.padEnd(labelWidth)}  ${row.value}`);
  }
  console.log(footer ? `└  ${footer}` : "└");
}

async function main(argv: string[]): Promise<void> {
  assertSupportedNode();

  const [rawCommand, ...args] = argv;
  const command = normalizeCommand(rawCommand);

  switch (command) {
    case "serve":
      const startRequest = rawCommand === "start" ? parseStartRequest(args) : undefined;
      if (startRequest && !startRequest.backgroundChild) {
        const launchRoot = resolve(process.cwd());
        process.env.AUVRYNT_ALLOWED_ROOTS = launchRoot;
        process.env.AUVRYNT_WORKTREE_ROOT = launchRoot;
        await ensureConfigured({ directoryScoped: true });
        if (!startRequest.profiles) await ensureIntegrationChoicesConfigured();
        await runBackgroundStart(startRequest);
        return;
      }
      if (rawCommand === "start") {
        // `start` is intentionally directory-scoped: the launch directory is
        // the only project root available to the web agent for this session.
        const launchRoot = resolve(process.cwd());
        process.env.AUVRYNT_ALLOWED_ROOTS = launchRoot;
        process.env.AUVRYNT_WORKTREE_ROOT = launchRoot;
      }
      await ensureConfigured({ directoryScoped: rawCommand === "start" });
      if (rawCommand === "start" && !startRequest?.profiles) {
        await ensureIntegrationChoicesConfigured();
      }
      if (startRequest?.profiles) applyIntegrationProfile(startRequest.profiles);
      const localConfig = loadConfig();
      const instanceLock = await acquireInstanceLock(localConfig.stateDir, localConfig.host, localConfig.port, startRequest?.profiles, resolve(process.cwd()));
      let tunnel: { process: ChildProcess; url: string } | undefined;
      let stopTunnel: (() => void) | undefined;
      try {
        if (rawCommand === "start") {
          process.env.AUVRYNT_START_MODE = "true";
          const launchRoot = resolve(process.cwd());
          await selfHealStartIntegrations(launchRoot, localConfig.executables, localConfig.integrations);
          const managedTunnelUrl = process.env.AUVRYNT_MANAGED_TUNNEL_URL;
          if (managedTunnelUrl) {
            process.env.AUVRYNT_PUBLIC_BASE_URL = managedTunnelUrl;
          } else {
            tunnel = await startCloudflareTunnel(localConfig.port);
            process.env.AUVRYNT_PUBLIC_BASE_URL = tunnel.url;
            stopTunnel = () => {
              if (tunnel && !tunnel.process.killed) tunnel.process.kill();
            };
            process.once("SIGINT", stopTunnel);
            process.once("SIGTERM", stopTunnel);
          }
        }
        await serve();
      } finally {
        if (stopTunnel) {
          process.removeListener("SIGINT", stopTunnel);
          process.removeListener("SIGTERM", stopTunnel);
          stopTunnel();
        }
        await instanceLock.release();
      }
      return;
    case "init":
      await runInit({ force: args.includes("--force") });
      return;
    case "doctor":
      await runDoctor();
      return;
    case "status":
      await runStatus();
      return;
    case "connected":
      runConnected();
      return;
    case "token":
      runToken(args);
      return;
    case "uninstall":
      await runUninstall(args.includes("--yes") || args.includes("-y"));
      return;
    case "config":
      runConfigCommand(args);
      return;
    case "setup":
      await runSetup(args);
      return;
    case "enable":
      await runEnable();
      return;
    case "disable":
      await runDisable();
      return;
    case "add":
      await runAdd(args);
      return;
    case "stop":
      await runStop();
      return;
    case "restart":
      {
        const restartRequest = parseStartRequest(args);
        const launchRoot = resolve(process.cwd());
        process.env.AUVRYNT_ALLOWED_ROOTS = launchRoot;
        process.env.AUVRYNT_WORKTREE_ROOT = launchRoot;
        await ensureConfigured({ directoryScoped: true });
        await runRestart(restartRequest, launchRoot);
      }
      return;
    case "help":
      printHelp();
      return;
  }
}

function normalizeCommand(command: string | undefined): Command {
  if (!command || command === "serve" || command === "start") return "serve";
  if (command === "init" || command === "doctor" || command === "config") return command;
  if (command === "status" || command === "connected" || command === "token" || command === "uninstall") return command;
  if (command === "setup" || command === "enable" || command === "disable" || command === "add" || command === "stop" || command === "restart") return command;
  if (command === "help" || command === "--help" || command === "-h") return "help";
  throw new Error(`Unknown command: ${command}`);
}

function applyIntegrationProfile(profiles: IntegrationKey[]): void {
  const selected = new Set(profiles);
  const environmentKeys: Record<IntegrationKey, string> = {
    godotGdscript: "AUVRYNT_GODOT_GDSCRIPT_ENABLED",
    godotCsharp: "AUVRYNT_GODOT_CSHARP_ENABLED",
    blender: "AUVRYNT_BLENDER_ENABLED",
    serena: "AUVRYNT_SERENA_INTEGRATION_ENABLED",
    playwright: "AUVRYNT_PLAYWRIGHT_ENABLED",
  };
  for (const key of INTEGRATION_KEYS) process.env[environmentKeys[key]] = selected.has(key) ? "true" : "false";
}

async function readActiveInstance(): Promise<{ stateDir: string; lockPath: string; record: InstanceLockRecord } | undefined> {
  const config = loadConfig();
  const lockPath = join(config.stateDir, "server.lock");
  const record = await readJsonFile<InstanceLockRecord>(lockPath);
  if (!record || !Number.isInteger(record.pid) || record.pid < 1) return undefined;

  const hasIdentity = Boolean(record.processPath && record.processStartedAt);
  const ownedProcess = hasIdentity
    ? processIdentityMatches(record.pid, record)
    : isProcessRunning(record.pid) && await isAuvryntHealthReachable(record.host, record.port);
  if (ownedProcess) return { stateDir: config.stateDir, lockPath, record };

  await unlink(lockPath).catch(() => undefined);
  return undefined;
}

function managedTunnelPath(stateDir: string): string {
  return join(stateDir, "tunnel.json");
}

async function readManagedTunnel(stateDir: string, port: number): Promise<ManagedTunnelRecord | undefined> {
  const tunnelPath = managedTunnelPath(stateDir);
  const record = await readJsonFile<ManagedTunnelRecord>(tunnelPath);
  if (record && Number.isInteger(record.pid) && record.pid > 0 && record.port === port
    && /^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com$/.test(record.url)) {
    if (processIdentityMatches(record.pid, record)) return record;

    // Migrate records written before process identity was persisted, but only
    // when the live executable is verifiably cloudflared.
    if (!record.processPath || !record.processStartedAt) {
      const identity = getProcessIdentity(record.pid);
      if (identity && /(^|[\\/])cloudflared\.exe$/i.test(identity.processPath)) {
        const migrated = { ...record, ...identity };
        await atomicWriteJson(tunnelPath, migrated);
        return migrated;
      }
    }
  }
  await unlink(tunnelPath).catch(() => undefined);
  return undefined;
}

async function ensureManagedTunnel(stateDir: string, port: number): Promise<{ record: ManagedTunnelRecord; created: boolean }> {
  const existing = await readManagedTunnel(stateDir, port);
  if (existing) return { record: existing, created: false };

  const tunnel = await startCloudflareTunnel(port, { detached: true, logPath: join(stateDir, "cloudflared.log") });
  if (!tunnel.process.pid) throw new Error("Cloudflare tunnel started without a process ID.");
  const identity = getProcessIdentity(tunnel.process.pid);
  if (!identity) {
    tunnel.process.kill();
    throw new Error("Could not verify the Cloudflare tunnel process.");
  }
  const record: ManagedTunnelRecord = { pid: tunnel.process.pid, url: tunnel.url, port, ...identity };
  await atomicWriteJson(managedTunnelPath(stateDir), record);
  return { record, created: true };
}

async function stopManagedTunnel(stateDir: string, port: number): Promise<boolean> {
  const tunnel = await readManagedTunnel(stateDir, port);
  if (!tunnel) return false;
  if (!processIdentityMatches(tunnel.pid, tunnel)) {
    await unlink(managedTunnelPath(stateDir)).catch(() => undefined);
    return false;
  }
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(tunnel.pid), "/F"], { stdio: "ignore" });
    } else {
      process.kill(tunnel.pid, "SIGTERM");
    }
  } catch {
    if (isProcessRunning(tunnel.pid)) throw new Error(`Could not stop Cloudflare tunnel process ${tunnel.pid}.`);
  } finally {
    await unlink(managedTunnelPath(stateDir)).catch(() => undefined);
  }
  return true;
}

function integrationsForProfiles(profiles: IntegrationKey[]): Record<IntegrationKey, boolean> {
  const enabled = new Set(profiles);
  return Object.fromEntries(INTEGRATION_KEYS.map((key) => [key, enabled.has(key)])) as Record<IntegrationKey, boolean>;
}

async function postInstanceControl(
  active: { record: InstanceLockRecord },
  path: string,
  body?: unknown,
): Promise<Response> {
  if (!active.record.controlToken) {
    throw new Error("The running Auvrynt instance predates live management. Run `auvrynt stop`, then start it again.");
  }
  return fetch(httpUrl(localProbeHost(active.record.host), active.record.port, path), {
    method: "POST",
    headers: {
      authorization: `Bearer ${active.record.controlToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

async function updateActiveProfiles(
  active: { stateDir: string; lockPath: string; record: InstanceLockRecord },
  profiles: IntegrationKey[],
): Promise<void> {
  const integrations = integrationsForProfiles(profiles);
  const config = loadConfig();
  const healed = await selfHealStartIntegrations(
    active.record.launchRoot ?? resolve(process.cwd()),
    config.executables,
    integrations,
  );
  const response = await postInstanceControl(active, "/__auvrynt/control/profiles", {
    integrations,
    serenaExecutable: healed.serenaExecutable,
  });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    throw new Error(result.error || `The running Auvrynt instance rejected the update (${response.status}).`);
  }
  active.record.profiles = profiles;
  await atomicWriteJson(active.lockPath, active.record);
}

async function terminateRootProcess(pid: number): Promise<void> {
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    if (isProcessRunning(pid)) throw new Error(`Could not stop Auvrynt process ${pid}.`);
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return !isProcessRunning(pid);
}

function findLegacyCloudflaredChildren(parentPid: number): Array<{ pid: number; processPath: string; processStartedAt: string }> {
  if (process.platform !== "win32") return [];
  try {
    const script = [
      `$items = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = ${parentPid}" -ErrorAction Stop`,
      "| Where-Object { $_.Name -ieq 'cloudflared.exe' }",
      "| ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { [pscustomobject]@{ pid = $_.ProcessId; processPath = $p.Path; processStartedAt = $p.StartTime.ToUniversalTime().ToString('o') } } })",
      "$items | ConvertTo-Json -Compress",
    ].join(" ; ").replace(/ ; \|/g, " |");
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.filter((item): item is { pid: number; processPath: string; processStartedAt: string } => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return Number.isInteger(candidate.pid)
        && typeof candidate.processPath === "string"
        && /(^|[\\/])cloudflared\.exe$/i.test(candidate.processPath)
        && typeof candidate.processStartedAt === "string";
    });
  } catch {
    return [];
  }
}

async function adoptLegacyManagedTunnel(
  active: { stateDir: string; record: InstanceLockRecord },
): Promise<ManagedTunnelRecord | undefined> {
  const existing = await readManagedTunnel(active.stateDir, active.record.port);
  if (existing) return existing;
  const children = findLegacyCloudflaredChildren(active.record.pid);
  if (children.length !== 1) return undefined;
  const output = await readFile(join(active.stateDir, "cloudflared.log"), "utf8").catch(() => "");
  const urls = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g);
  const url = urls?.at(-1);
  if (!url) return undefined;
  const child = children[0];
  const record: ManagedTunnelRecord = { ...child, url, port: active.record.port };
  await atomicWriteJson(managedTunnelPath(active.stateDir), record);
  return record;
}

async function waitForBackgroundReady(
  stateDir: string,
  pid: number,
  host: string,
  port: number,
  spawnError: () => Error | undefined,
): Promise<InstanceLockRecord> {
  const deadline = Date.now() + 30_000;
  const lockPath = join(stateDir, "server.lock");
  while (Date.now() < deadline) {
    const error = spawnError();
    if (error) throw new Error(`Auvrynt failed to start: ${error.message}`);
    if (!isProcessRunning(pid)) throw new Error("Auvrynt exited before becoming ready.");
    const record = await readJsonFile<InstanceLockRecord>(lockPath);
    if (record?.pid === pid && await isAuvryntHealthReachable(host, port) && processIdentityMatches(pid, record)) {
      return record;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error("Auvrynt did not become ready within 30 seconds.");
}

async function runBackgroundStartUnlocked(request: StartRequest, launchRoot: string): Promise<void> {
  const active = await readActiveInstance();
  const config = loadConfig();
  const saved = completeIntegrationsConfig(loadAuvryntFiles().config.integrations);
  const profiles = request.profiles ?? INTEGRATION_KEYS.filter((key) => saved[key]);
  if (active) {
    let replace = request.replace;
    if (!replace && input.isTTY && output.isTTY) {
      const answer = await prompts.confirm({ message: `Replace running Auvrynt instance (PID ${active.record.pid})?`, initialValue: false });
      if (prompts.isCancel(answer) || !answer) {
        printConsolePanel("Auvrynt start cancelled");
        return;
      }
      replace = true;
    }
    if (!replace) throw new Error(`Auvrynt is already running (PID ${active.record.pid}). Re-run with --replace to override it.`);
    if (resolve(active.record.launchRoot ?? launchRoot) === resolve(launchRoot) && active.record.controlToken) {
      await updateActiveProfiles(active, profiles);
      const tunnel = await readManagedTunnel(active.stateDir, active.record.port);
      printConsolePanel("Auvrynt updated", [
        { label: "PID", value: String(active.record.pid) },
        { label: "Workspace", value: active.record.launchRoot ?? launchRoot },
        { label: "Integrations", value: profiles.map((key) => INTEGRATION_LABELS[key]).join(", ") || "none" },
        ...(tunnel ? [{ label: "Public MCP", value: `${tunnel.url}/mcp` }] : []),
      ], "Server and tunnel kept running");
      return;
    }
    await adoptLegacyManagedTunnel(active);
    await stopActiveInstance(active);
  }

  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  await selfHealStartIntegrations(launchRoot, config.executables, integrationsForProfiles(profiles));
  const tunnelResult = await ensureManagedTunnel(config.stateDir, config.port);
  const tunnel = tunnelResult.record;
  const logPath = join(config.stateDir, "auvrynt.log");
  await rotateLogFile(logPath);
  const logHandle = openSync(logPath, "a", 0o600);
  const childArgs = [process.argv[1], "start", "--background-child"];
  if (profiles.length > 0) childArgs.push(profiles.join(","));
  const controlToken = randomBytes(32).toString("base64url");
  const child = spawn(process.execPath, childArgs, {
    cwd: launchRoot,
    detached: true,
    stdio: ["ignore", logHandle, logHandle],
    windowsHide: true,
    env: { ...process.env, AUVRYNT_CONTROL_TOKEN: controlToken, AUVRYNT_MANAGED_TUNNEL_URL: tunnel.url },
  });
  closeSync(logHandle);
  let childSpawnError: Error | undefined;
  child.once("error", (error) => {
    childSpawnError = error;
  });
  if (!child.pid) {
    if (tunnelResult.created) await stopManagedTunnel(config.stateDir, config.port);
    throw new Error("Auvrynt could not create its background process.");
  }
  child.unref();
  try {
    await waitForBackgroundReady(config.stateDir, child.pid, config.host, config.port, () => childSpawnError);
  } catch (error) {
    await terminateRootProcess(child.pid).catch(() => undefined);
    if (tunnelResult.created) await stopManagedTunnel(config.stateDir, config.port).catch(() => undefined);
    throw error;
  }
  const profileText = profiles.map((key) => INTEGRATION_LABELS[key]).join(", ") || "no optional integrations";
  printConsolePanel("Auvrynt started", [
    { label: "PID", value: String(child.pid) },
    { label: "Workspace", value: launchRoot },
    { label: "Integrations", value: profileText },
    { label: "Public MCP", value: `${tunnel.url}/mcp` },
  ], "Next: auvrynt status  |  Stop: auvrynt stop");
}

async function runBackgroundStart(request: StartRequest, launchRoot = resolve(process.cwd())): Promise<void> {
  const config = loadConfig();
  const management = await acquireManagementLock(config.stateDir);
  try {
    await runBackgroundStartUnlocked(request, launchRoot);
  } finally {
    await management.release();
  }
}

async function stopActiveInstance(active: { stateDir: string; lockPath: string; record: InstanceLockRecord }): Promise<void> {
  const hasIdentity = Boolean(active.record.processPath && active.record.processStartedAt);
  const stillOwned = hasIdentity
    ? processIdentityMatches(active.record.pid, active.record)
    : isProcessRunning(active.record.pid) && await isAuvryntHealthReachable(active.record.host, active.record.port);
  if (!stillOwned) {
    if (isProcessRunning(active.record.pid) || await isAuvryntHealthReachable(active.record.host, active.record.port)) {
      throw new Error(`Auvrynt PID ${active.record.pid} is still running but its process identity could not be verified. Refusing to stop an unowned process.`);
    }
    await unlink(active.lockPath).catch(() => undefined);
    return;
  }
  const managedTunnel = await readManagedTunnel(active.stateDir, active.record.port);
  const legacyTunnels = active.record.controlToken
    ? []
    : findLegacyCloudflaredChildren(active.record.pid).filter((candidate) => candidate.pid !== managedTunnel?.pid);
  if (active.record.controlToken) {
    try {
      const response = await postInstanceControl(active, "/__auvrynt/control/shutdown");
      if (!response.ok) throw new Error(`Shutdown request failed (${response.status}).`);
    } catch {
      await terminateRootProcess(active.record.pid);
    }
  } else {
    await terminateRootProcess(active.record.pid);
  }
  if (!await waitForProcessExit(active.record.pid, 10_000)) {
    await terminateRootProcess(active.record.pid);
  }
  if (!await waitForProcessExit(active.record.pid, 2_000)) throw new Error(`Could not stop Auvrynt process ${active.record.pid}.`);
  for (const tunnel of legacyTunnels) {
    if (!processIdentityMatches(tunnel.pid, tunnel)) continue;
    await terminateRootProcess(tunnel.pid).catch(() => undefined);
  }
  const current = await readJsonFile<InstanceLockRecord>(active.lockPath);
  if (current?.instanceId === active.record.instanceId) {
    await unlink(active.lockPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
}

async function runStop(): Promise<void> {
  const config = loadConfig();
  const management = await acquireManagementLock(config.stateDir);
  let active: Awaited<ReturnType<typeof readActiveInstance>>;
  let tunnelStopped = false;
  let serverError: unknown;
  let tunnelError: unknown;
  try {
    active = await readActiveInstance();
    try {
      if (active) await stopActiveInstance(active);
    } catch (error) {
      serverError = error;
    } finally {
      try {
        tunnelStopped = await stopManagedTunnel(config.stateDir, config.port);
      } catch (error) {
        tunnelError = error;
      }
    }
  } finally {
    await management.release();
  }
  if (serverError || tunnelError) {
    throw new AggregateError(
      [serverError, tunnelError].filter((error): error is object => Boolean(error)),
      "Auvrynt could not stop all managed processes.",
    );
  }
  const remaining = await readActiveInstance();
  if (remaining || await isAuvryntHealthReachable(config.host, config.port)) {
    throw new Error("Auvrynt stop did not verify that the managed server exited.");
  }
  if (await readManagedTunnel(config.stateDir, config.port)) {
    throw new Error("Auvrynt stop did not verify that the managed Cloudflare tunnel exited.");
  }
  if (!active && !tunnelStopped) return void printConsolePanel("Auvrynt", [{ label: "Status", value: "Not running" }]);
  printConsolePanel("Auvrynt stopped", [
    { label: "Server", value: "Stopped" },
    { label: "Tunnel", value: "Stopped" },
  ], "Start again: auvrynt start");
}

async function runRestart(request: StartRequest, launchRoot: string): Promise<void> {
  const active = await readActiveInstance();
  const profiles = request.profiles ?? active?.record.profiles;
  if (!profiles) await ensureIntegrationChoicesConfigured();
  await runStop();
  await runBackgroundStart({ ...request, profiles, replace: true, backgroundChild: false }, launchRoot);
}

async function runAdd(args: string[]): Promise<void> {
  const additions = parseIntegrationProfiles(args);
  const config = loadConfig();
  const management = await acquireManagementLock(config.stateDir);
  try {
    const active = await readActiveInstance();
    const saved = completeIntegrationsConfig(loadAuvryntFiles().config.integrations);
    const current = active?.record.profiles ?? INTEGRATION_KEYS.filter((key) => saved[key]);
    const profiles = Array.from(new Set([...current, ...additions]));
    if (active) {
      if (!active.record.controlToken) {
        await adoptLegacyManagedTunnel(active);
        await stopActiveInstance(active);
        await runBackgroundStartUnlocked(
          { profiles, replace: true, backgroundChild: false },
          active.record.launchRoot ?? resolve(process.cwd()),
        );
        return;
      }
      await updateActiveProfiles(active, profiles);
      const tunnel = await readManagedTunnel(active.stateDir, active.record.port);
      printConsolePanel("Auvrynt integrations updated", [
        { label: "PID", value: String(active.record.pid) },
        { label: "Integrations", value: profiles.map((key) => INTEGRATION_LABELS[key]).join(", ") },
        ...(tunnel ? [{ label: "Public MCP", value: `${tunnel.url}/mcp` }] : []),
      ], "Server and tunnel kept running");
      return;
    }
    await runBackgroundStartUnlocked(
      { profiles, replace: true, backgroundChild: false },
      resolve(process.cwd()),
    );
  } finally {
    await management.release();
  }
}

async function ensureConfigured(options: { directoryScoped?: boolean } = {}): Promise<void> {
  const files = loadAuvryntFiles();
  if (files.configExists && files.authExists) return;
  if (process.env.AUVRYNT_OAUTH_OWNER_TOKEN) return;

  if (options.directoryScoped) {
    const launchRoot = resolve(process.cwd());
    if (!files.configExists) {
      writeAuvryntConfig({
        host: files.config.host ?? "127.0.0.1",
        port: files.config.port ?? 49321,
        allowedRoots: [launchRoot],
        publicBaseUrl: files.config.publicBaseUrl ?? `http://127.0.0.1:${files.config.port ?? 49321}`,
      });
    }
    if (!files.authExists) {
      writeAuvryntAuth({ ownerToken: generateOwnerToken() });
    }
    return;
  }

  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      [
        "Auvrynt is not configured and this terminal is non-interactive.",
        "",
        "Run:",
        "  auvrynt init",
        "",
        "Or provide AUVRYNT_OAUTH_OWNER_TOKEN and AUVRYNT_ALLOWED_ROOTS.",
      ].join("\n"),
    );
  }

  await runInit({ force: false });
}

async function runInit({ force }: { force: boolean }): Promise<void> {
  const files = loadAuvryntFiles();
  if (!force && files.configExists && files.authExists) {
    prompts.log.info(`Auvrynt is already configured at ${files.dir}`);
    prompts.log.info("Run `auvrynt init --force` to update it.");
    return;
  }

  try {
    prompts.intro("Auvrynt setup");

    const defaultRoots = files.config.allowedRoots?.join(", ") || process.cwd();
    const rootsAnswer = await textPrompt({
      message: `Where are your projects located? Press Enter to use ${defaultRoots}`,
      placeholder: defaultRoots,
      defaultValue: defaultRoots,
      validate: (value) => value?.trim() ? undefined : "Enter at least one project root.",
    });
    const allowedRoots = rootsAnswer
      .split(",")
      .map((root) => resolve(expandHomePath(root.trim())))
      .filter(Boolean);

    const defaultPort = String(files.config.port ?? 49321);
    const portAnswer = await textPrompt({
      message: `Which local port should Auvrynt use? Press Enter to use ${defaultPort}`,
      placeholder: defaultPort,
      defaultValue: defaultPort,
      validate: validatePort,
    });
    const port = Number(portAnswer);

    prompts.note(
      [
        "Auvrynt needs a public base URL so ChatGPT or Claude can reach this MCP server.",
        "Create a tunnel or reverse proxy with Cloudflare Tunnel, ngrok, Pinggy, Tailscale Funnel, or your own HTTPS proxy.",
        "Paste the public origin here, without /mcp.",
        "",
        "Example: https://your-tunnel-host.example.com",
      ].join("\n"),
      "Public URL required",
    );
    const publicBaseUrl = normalizePublicBaseUrl(await textPrompt({
      message: files.config.publicBaseUrl
        ? `What is the public base URL? Press Enter to keep ${files.config.publicBaseUrl}`
        : "What is the public base URL?",
      placeholder: files.config.publicBaseUrl ?? "https://your-tunnel-host.example.com",
      defaultValue: files.config.publicBaseUrl ?? "",
      validate: validateRequiredPublicBaseUrl,
    }));

    const config: AuvryntUserConfig = {
      host: files.config.host ?? "127.0.0.1",
      port,
      allowedRoots,
      publicBaseUrl,
    };
    const auth = {
      ownerToken: files.auth.ownerToken ?? generateOwnerToken(),
    };

    const configPath = writeAuvryntConfig(config);
    const authPath = writeAuvryntAuth(auth);

    const lines = [
      `Config: ${configPath}`,
      `Auth: ${authPath}`,
      `Local MCP URL: ${httpUrl(config.host ?? "127.0.0.1", config.port ?? 49321, "/mcp")}`,
      ...(publicBaseUrl ? [`Public MCP URL: ${publicBaseUrl}/mcp`] : []),
    ];
    prompts.note(lines.join("\n"), "Auvrynt configured");
    prompts.note(
      [
        `Owner token: ${auth.ownerToken}`,
        "Use this when ChatGPT or Claude asks you to approve Auvrynt access.",
        `Stored at: ${authPath}`,
      ].join("\n"),
      "Owner token",
    );
    prompts.outro("Run `auvrynt start` to start the MCP server.");
  } catch (error) {
    if (error instanceof SetupCancelledError) {
      prompts.cancel("Setup cancelled");
      return;
    }
    throw error;
  }
}

async function serve(): Promise<void> {
  const sqliteStatus = checkSqliteNative();
  if (sqliteStatus !== "ok") {
    throw new Error(
      [
        "better-sqlite3 could not load for this Node runtime.",
        sqliteStatus,
        "",
        "Try reinstalling or rebuilding dependencies under the active Node version:",
        "  npm rebuild better-sqlite3",
      ].join("\n"),
    );
  }

  const { createServer } = await import("./server.js");
  const config = loadConfig();
  const runningServer = createServer(config);
  const { app } = runningServer;

  const startMode = process.env.AUVRYNT_START_MODE === "true";
  const files = loadAuvryntFiles();
  const publicMcpUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, "")}/mcp`
    : httpUrl(config.host, config.port, "/mcp");

  const godotPlugin = getGlobalGodotPluginStatus();
  const godotIsSetup = Boolean(config.executables.godot || config.executables.godotCsharp);

  // Probe integration ports before starting the server
  const integrationStatus = await discoverLocalIntegrations();
  const controlToken = process.env.AUVRYNT_CONTROL_TOKEN;
  let requestShutdown: (() => void) | undefined;

  const controlAuthorized = (authorization: string | undefined): boolean => {
    if (!controlToken || !authorization?.startsWith("Bearer ")) return false;
    const provided = Buffer.from(authorization.slice("Bearer ".length));
    const expected = Buffer.from(controlToken);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  };

  if (controlToken) {
    app.post("/__auvrynt/control/profiles", async (req, res) => {
      if (!controlAuthorized(req.header("authorization"))) {
        res.status(404).end();
        return;
      }
      const body = req.body as { integrations?: unknown; serenaExecutable?: unknown };
      const integrations = body?.integrations;
      if (!integrations || typeof integrations !== "object"
        || !INTEGRATION_KEYS.every((key) => typeof (integrations as Record<string, unknown>)[key] === "boolean")) {
        res.status(400).json({ error: "Invalid integration profile." });
        return;
      }
      const result = await runningServer.updateIntegrations(
        integrations as Record<IntegrationKey, boolean>,
        typeof body.serenaExecutable === "string" ? { serenaExecutable: body.serenaExecutable } : undefined,
      );
      if (!result.updated) {
        res.status(409).json({ error: "An MCP request is active; retry after it finishes.", ...result });
        return;
      }
      res.json(result);
    });

    app.post("/__auvrynt/control/shutdown", (req, res) => {
      if (!controlAuthorized(req.header("authorization"))) {
        res.status(404).end();
        return;
      }
      res.status(202).json({ stopping: true });
      setImmediate(() => requestShutdown?.());
    });
  }

  function integrationLine(label: string, reachable: boolean, configured?: boolean, enabled = true): string {
    const padded = label.padEnd(20);
    if (!enabled) {
      return `  \x1b[90m${padded}\x1b[0m  \x1b[90mdisabled\x1b[0m`;
    }
    if (reachable) {
      return `  \x1b[90m${padded}\x1b[0m  \x1b[32m200 OK\x1b[0m`;
    } else if (configured) {
      return `  \x1b[90m${padded}\x1b[0m  \x1b[33moffline\x1b[0m`;
    }
    return `  \x1b[90m${padded}\x1b[0m  \x1b[90mnot configured\x1b[0m`;
  }

  await new Promise<void>((resolveServer, rejectServer) => {
    const httpServer = app.listen(config.port, config.host, () => {
    if (startMode) {
      console.clear();
      console.log("");
      console.log("  \x1b[36m\x1b[1mAuvrynt: Webkit Arsenal is ready\x1b[0m");
      console.log("");

      // Integration status rows
      const godotBridgeUp = integrationStatus.ports.auvrynt_godot_bridge;
      const blenderBridgeUp = integrationStatus.ports.auvrynt_blender_bridge || integrationStatus.ports.blender_lab_mcp;
      const godotConfigured = godotIsSetup || godotPlugin.installed;
      const godotCsharpConfigured = Boolean(config.executables.godotCsharp);
      // Blender Lab's MCP extension is discovered by its local port. A Blender
      // executable path is optional and must not control this status label.
      const blenderConfigured = true;
      const serenaConfigured = Boolean(process.env.AUVRYNT_SERENA_EXECUTABLE || integrationStatus.executables.serena || processDetected(integrationStatus, "serena"));
      const playwrightReady = getPlaywrightRuntimeStatus().chromiumInstalled;
      console.log(integrationLine("Godot GDScript:", godotBridgeUp, godotConfigured, config.integrations.godotGdscript));
      console.log(integrationLine("Godot C#:", godotBridgeUp, godotCsharpConfigured, config.integrations.godotCsharp));
      console.log(integrationLine("Blender:", blenderBridgeUp, blenderConfigured, config.integrations.blender));
      console.log(integrationLine("Serena:", serenaConfigured, serenaConfigured, config.integrations.serena));
      console.log(integrationLine("Playwright:", playwrightReady, playwrightReady, config.integrations.playwright));
      console.log("");

      console.log("  \x1b[90mWeb Agent connector URL:\x1b[0m");
      console.log("    \x1b[36m" + publicMcpUrl + "\x1b[0m");
      console.log("  \x1b[90mAuthorization page:\x1b[0m");
      console.log("    \x1b[36m" + config.publicBaseUrl.replace(/\/$/, "") + "/authorize\x1b[0m");
      console.log("  \x1b[90mOwner token:\x1b[0m");
      console.log("    \x1b[33mhidden — run `auvrynt token` locally to view\x1b[0m");
      console.log("");
      console.log("  \x1b[90mNote:\x1b[0m");
      console.log("    Web-agent workspace: " + config.allowedRoots.join(", "));
      console.log("    The Cloudflare URL is temporary.");
      console.log("    Recreate or edit the web agent connector after restart.");
      console.log("");

      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let frameIndex = 0;
      let mcpEventsCount = 0;
      let lastEvent = "Started successfully";

      (global as any).auvryntLogEmitter = (level: string, event: string) => {
        mcpEventsCount++;
        lastEvent = `${event} (${level})`;
      };

      const interval = setInterval(() => {
        const frame = frames[frameIndex];
        frameIndex = (frameIndex + 1) % frames.length;
        process.stdout.write(`\r\x1b[K  \x1b[32m${frame}\x1b[0m Logs active... (${mcpEventsCount} requests handled | Last: ${lastEvent})`);
      }, 100);

      (global as any).auvryntStartInterval = interval;
    } else {
      console.log(`auvrynt listening on ${httpUrl(config.host, config.port, "/mcp")}`);
      console.log(`public base url: ${config.publicBaseUrl}`);
      console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
      console.log(`allowed hosts: ${config.allowedHosts.join(", ")}`);
      if (config.allowedHosts.includes("*")) {
        console.warn("warning: Host header allowlist is disabled because AUVRYNT_ALLOWED_HOSTS=*");
      }
      console.log("auth: Owner token approval required");
      console.log(`logging: ${config.logging.level} ${config.logging.format}`);
    }
  });

    let shutdownStarted = false;
    const removeSignalHandlers = () => {
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
    };
    const shutdown = () => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      if ((global as any).auvryntStartInterval) {
        clearInterval((global as any).auvryntStartInterval);
        delete (global as any).auvryntStartInterval;
      }
      delete (global as any).auvryntLogEmitter;

      const forceClose = setTimeout(() => httpServer.closeAllConnections(), 5_000);
      forceClose.unref();
      httpServer.close(() => {
        clearTimeout(forceClose);
        void runningServer.close().finally(() => {
          removeSignalHandlers();
          resolveServer();
        });
      });
    };
    requestShutdown = shutdown;
    httpServer.once("error", (error) => {
      removeSignalHandlers();
      void runningServer.close().finally(() => rejectServer(error));
    });
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function runDoctor(): Promise<void> {
  const files = loadAuvryntFiles();
  const rows: ConsoleRow[] = [
    { label: "Config dir", value: files.dir },
    { label: "Config", value: files.configExists ? files.configPath : "Missing" },
    { label: "Auth", value: files.authExists ? files.authPath : "Missing" },
    { label: "Node", value: `${process.version} (${nodeVersionStatus()}), ABI ${process.versions.modules}` },
    { label: "Platform", value: `${process.platform} ${process.arch}` },
    { label: "Git", value: checkGitAvailable() },
    { label: "Bash", value: checkBashShell() },
    { label: "SQLite", value: checkSqliteNative() },
  ];

  try {
    const config = loadConfig();
    rows.push(
      { label: "Local MCP", value: httpUrl(config.host, config.port, "/mcp") },
      { label: "Public MCP", value: new URL("/mcp", config.publicBaseUrl).toString() },
      { label: "Roots", value: config.allowedRoots.join(", ") },
      { label: "Hosts", value: config.allowedHosts.join(", ") },
    );
  } catch (error) {
    rows.push({ label: "Config status", value: error instanceof Error ? error.message : String(error) });
  }
  printConsolePanel("Auvrynt doctor", rows);
}

async function acquireInstanceLock(
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

      const ownerPid = Number.isInteger(lock?.pid) && Number(lock?.pid) > 0 ? Number(lock?.pid) : undefined;
      const hasIdentity = Boolean(lock?.processPath && lock?.processStartedAt);
      const ownerMatches = ownerPid
        ? hasIdentity ? processIdentityMatches(ownerPid, lock ?? {}) : isProcessRunning(ownerPid)
        : false;
      if (ownerPid && ownerMatches) {
        const lockHost = typeof lock?.host === "string" ? lock.host : host;
        const candidateLockPort = lock?.port;
        const lockPort = Number.isInteger(candidateLockPort) ? Number(candidateLockPort) : port;
        const healthy = await isAuvryntHealthReachable(lockHost, lockPort);
        const lockStartedAt = lock?.startedAt;
        const lockAgeMs = typeof lockStartedAt === "string"
          ? Date.now() - Date.parse(lockStartedAt)
          : Number.POSITIVE_INFINITY;
        if (healthy || (Number.isFinite(lockAgeMs) && lockAgeMs >= 0 && lockAgeMs < 30_000)) {
          throw new Error(`Auvrynt is already running (PID ${ownerPid}). Stop that instance before starting another.`);
        }
      }

      await unlink(lockPath).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      });
    }
  }

  throw new Error("Could not acquire the Auvrynt server lock after clearing stale lock state.");
}

async function isAuvryntHealthReachable(host: string, port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  if (!host || /[\/@?#]/.test(host)) return false;
  try {
    const response = await fetch(httpUrl(localProbeHost(host), port, "/healthz"), {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => undefined) as { ok?: unknown; name?: unknown } | undefined;
    return body?.ok === true && body?.name === "auvrynt";
  } catch {
    return false;
  }
}

async function releaseInstanceLock(lockPath: string, instanceId: string): Promise<void> {
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

async function startCloudflareTunnel(port: number, options: { detached?: boolean; logPath?: string } = {}): Promise<{ process: ChildProcess; url: string }> {
  const executable = await resolveCloudflaredExecutable();
  if (options.detached && options.logPath) {
    await writeFile(options.logPath, "", { mode: 0o600 });
    const logHandle = openSync(options.logPath, "a");
    const child = spawn(executable, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
      stdio: ["ignore", logHandle, logHandle],
      windowsHide: true,
      detached: true,
    });
    closeSync(logHandle);
    let spawnError: Error | undefined;
    child.once("error", (error) => {
      spawnError = error;
    });

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (spawnError) throw new Error(`Cloudflare tunnel failed to start: ${spawnError.message}`);
      if (!child.pid || !isProcessRunning(child.pid)) {
        throw new Error("Cloudflare tunnel exited before connecting.");
      }
      const output = await readFile(options.logPath, "utf8").catch(() => "");
      const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        child.unref();
        return { process: child, url: match[0] };
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    child.kill();
    throw new Error("Cloudflare tunnel did not provide a public URL within 30 seconds.");
  }

  const child = spawn(executable, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: options.detached,
  });
  const tunnelUrl = await new Promise<string>((resolveUrl, reject) => {
    let output = "";
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onOutput);
      child.stderr?.off("data", onOutput);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error("Cloudflare tunnel did not provide a public URL within 30 seconds."));
    }, 30_000);
    const onOutput = (chunk: Buffer | string) => {
      if (settled) return;
      output += chunk.toString();
      if (output.length > 1024 * 1024) {
        child.kill();
        fail(new Error("Cloudflare tunnel startup output exceeded 1 MB before providing a public URL."));
        return;
      }
      const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        settled = true;
        cleanup();
        resolveUrl(match[0]);
      }
    };
    const onError = (error: Error) => {
      fail(new Error(`Cloudflare tunnel failed to start: ${error.message}`));
    };
    const onExit = (code: number | null) => {
      if (code !== null) fail(new Error(`Cloudflare tunnel exited before connecting (code ${code}).`));
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    child.once("error", onError);
    child.once("exit", onExit);
  });

  return { process: child, url: tunnelUrl };
}

async function resolveCloudflaredExecutable(): Promise<string> {
  try {
    return execFileSync(
      process.platform === "win32" ? "where.exe" : "which",
      ["cloudflared"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    ).split(/\r?\n/)[0]?.trim() || "cloudflared";
  } catch {
    if (process.platform === "win32") {
      const managedExecutable = join(homedir(), ".auvrynt", "bin", "cloudflared.exe");
      if (existsSync(managedExecutable)) {
        try {
          execFileSync(managedExecutable, ["--version"], { stdio: "ignore", windowsHide: true });
          return managedExecutable;
        } catch {
          // A partial or corrupt managed binary is replaced by the verified installer below.
        }
      }
      return installWindowsCloudflared();
    }
    throw new Error(
      "cloudflared is required for `auvrynt start`. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/.",
    );
  }
}

function findCommand(command: string): string | undefined {
  try {
    return execFileSync(
      process.platform === "win32" ? "where.exe" : "which",
      [command],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    ).split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

async function ensureGodotPluginForLaunchRoot(launchRoot: string): Promise<void> {
  const projectFile = join(launchRoot, "project.godot");
  if (!existsSync(projectFile)) return;

  const sourceDir = join(packageRoot(), "addons", "auvrynt_bridge");
  if (!existsSync(sourceDir)) return;

  const targetDir = join(launchRoot, "addons", "auvrynt_bridge");
  await mkdir(dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });

  const pluginPath = "res://addons/auvrynt_bridge/plugin.cfg";
  let project = await readFile(projectFile, "utf8");
  if (project.includes(`\"${pluginPath}\"`)) return;

  const sectionPattern = /\[editor_plugins\][\s\S]*?(?=\r?\n\[[^\]]+\]|$)/;
  const sectionMatch = project.match(sectionPattern);
  if (sectionMatch) {
    const section = sectionMatch[0];
    const enabledPattern = /enabled\s*=\s*PackedStringArray\(([^)]*)\)/;
    const enabledMatch = section.match(enabledPattern);
    const updatedSection = enabledMatch
      ? section.replace(enabledPattern, (_full, values: string) => {
          const separator = values.trim() ? ", " : "";
          return `enabled=PackedStringArray(${values}${separator}\"${pluginPath}\")`;
        })
      : `${section.trimEnd()}\r\nenabled=PackedStringArray(\"${pluginPath}\")\r\n`;
    project = project.replace(section, updatedSection);
  } else {
    project = `${project.trimEnd()}\r\n\r\n[editor_plugins]\r\n\r\nenabled=PackedStringArray(\"${pluginPath}\")\r\n`;
  }

  await writeFile(projectFile, project, "utf8");
}

async function selfHealStartIntegrations(
  launchRoot: string,
  executables: Record<string, string | undefined>,
  integrations: Record<IntegrationKey, boolean>,
): Promise<{ serenaExecutable?: string }> {
  let serenaExecutable: string | undefined;
  if (integrations.serena) {
    process.env.AUVRYNT_SERENA_ENABLED = "true";
    serenaExecutable = await ensureSerenaExecutable();
    process.env.AUVRYNT_SERENA_EXECUTABLE = serenaExecutable;
    execFileSync(serenaExecutable, ["--version"], { stdio: "ignore", windowsHide: true });
  } else {
    process.env.AUVRYNT_SERENA_ENABLED = "false";
  }

  if (integrations.playwright) {
    ensurePlaywrightRuntime();
  }

  if (!integrations.godotGdscript && !integrations.godotCsharp) return { serenaExecutable };

  ensureGlobalGodotPlugin();
  await ensureGodotPluginForLaunchRoot(launchRoot);

  if (!existsSync(join(launchRoot, "project.godot"))) return { serenaExecutable };

  let discovery = await discoverLocalIntegrations();
  if (!discovery.ports.auvrynt_godot_bridge && !processDetected(discovery, "godot")) {
    const godotExecutable = integrations.godotCsharp
      ? executables.godotCsharp || executables.godot || discovery.executables.godotCsharp || discovery.executables.godot
      : executables.godot || discovery.executables.godot;
    if (godotExecutable && existsSync(godotExecutable)) {
      const child = spawn(godotExecutable, ["--editor", "--path", launchRoot], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
    }
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    discovery = await discoverLocalIntegrations();
    if (discovery.ports.auvrynt_godot_bridge) return { serenaExecutable };
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  return { serenaExecutable };
}

async function ensureSerenaExecutable(): Promise<string> {
  const existing = findCommand("serena");
  if (existing) return existing;

  const configuredLocalSource = process.env.AUVRYNT_SERENA_LOCAL_SOURCE?.trim();
  const localSource = configuredLocalSource
    ? resolve(expandHomePath(configuredLocalSource))
    : undefined;
  if (localSource && !existsSync(join(localSource, "pyproject.toml"))) {
    throw new Error(`AUVRYNT_SERENA_LOCAL_SOURCE does not contain pyproject.toml: ${localSource}`);
  }
  const uv = await ensureUvExecutable();

  console.log(localSource
    ? `Serena is not installed; installing explicitly configured local source ${localSource}...`
    : `Serena is not installed; installing pinned ${MANAGED_SERENA_PACKAGE}...`);
  const installArgs = localSource
    ? ["tool", "install", "--force", "--editable", localSource]
    : ["tool", "install", "--force", MANAGED_SERENA_PACKAGE];
  execFileSync(uv, installArgs, { stdio: "inherit" });

  const installed = findCommand("serena") ?? findInstalledExecutable("serena");
  if (!installed) {
    throw new Error("Serena installed but its executable is not available. Restart PowerShell and run `where.exe serena`.");
  }
  return installed;
}

async function ensureUvExecutable(): Promise<string> {
  const existing = findCommand("uv");
  if (existing) return existing;

  const python = findCommand("py") ?? findCommand("python");
  if (!python) {
    throw new Error("Serena requires uv, and Python was not found to install it automatically.");
  }
  console.log(`uv is not installed; installing pinned ${MANAGED_UV_PACKAGE} for Serena...`);
  execFileSync(python, ["-m", "pip", "install", "--user", MANAGED_UV_PACKAGE], { stdio: "inherit" });

  const installed = findCommand("uv") ?? findInstalledExecutable("uv");
  if (!installed) {
    throw new Error("uv was installed but its executable is not available. Restart PowerShell and run `uv --version`.");
  }
  return installed;
}

function findInstalledExecutable(name: string): string | undefined {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const candidates = [
    join(homedir(), ".local", "bin", executable),
    join(process.env.LOCALAPPDATA ?? "", "uv", "bin", executable),
    join(process.env.APPDATA ?? "", "uv", "bin", executable),
    join(process.env.APPDATA ?? "", "Python", "Python313", "Scripts", executable),
    join(process.env.APPDATA ?? "", "Python", "Python312", "Scripts", executable),
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

async function installWindowsCloudflared(): Promise<string> {
  const targetDir = join(homedir(), ".auvrynt", "bin");
  const executable = join(targetDir, "cloudflared.exe");
  const artifact = process.arch === "arm64"
    ? "cloudflared-windows-arm64.exe"
    : process.arch === "ia32"
      ? "cloudflared-windows-386.exe"
      : "cloudflared-windows-amd64.exe";
  const releaseUrl = `https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${MANAGED_CLOUDFLARED_VERSION}`;

  console.log(`cloudflared is not installed; downloading verified ${MANAGED_CLOUDFLARED_VERSION}...`);
  const releaseResponse = await fetch(releaseUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "auvrynt-cloudflared-installer",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!releaseResponse.ok) {
    throw new Error(`Could not load cloudflared release metadata (HTTP ${releaseResponse.status}).`);
  }
  const release = await releaseResponse.json() as {
    tag_name?: unknown;
    assets?: Array<{ name?: unknown; browser_download_url?: unknown; digest?: unknown }>;
  };
  if (release.tag_name !== MANAGED_CLOUDFLARED_VERSION || !Array.isArray(release.assets)) {
    throw new Error("Cloudflared release metadata did not match the pinned release.");
  }
  const asset = release.assets.find((candidate) => candidate.name === artifact);
  if (!asset || typeof asset.browser_download_url !== "string" || typeof asset.digest !== "string") {
    throw new Error(`Cloudflared release ${MANAGED_CLOUDFLARED_VERSION} is missing ${artifact} or its SHA-256 digest.`);
  }
  const expectedPrefix = `https://github.com/cloudflare/cloudflared/releases/download/${MANAGED_CLOUDFLARED_VERSION}/`;
  if (!asset.browser_download_url.startsWith(expectedPrefix) || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest)) {
    throw new Error("Cloudflared release asset metadata failed origin/digest validation.");
  }

  const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Could not download cloudflared (HTTP ${response.status}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  const expectedDigest = asset.digest.slice("sha256:".length).toLowerCase();
  if (actualDigest !== expectedDigest) {
    throw new Error("Cloudflared SHA-256 verification failed; the downloaded binary was not installed.");
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(executable, bytes, { mode: 0o755 });
  execFileSync(executable, ["--version"], { stdio: "ignore" });
  return executable;
}

async function runStatus(): Promise<void> {
  const files = loadAuvryntFiles();
  const config = loadConfig();
  const host = files.config.host ?? "127.0.0.1";
  const port = files.config.port ?? 49321;
  const healthUrl = httpUrl(localProbeHost(host), port, "/healthz");
  const active = await readActiveInstance();
  const tunnel = await readManagedTunnel(loadConfig().stateDir, port);
  const rows: ConsoleRow[] = [];

  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; name?: string };
    rows.push({ label: "Local MCP", value: response.ok && body.ok ? "Connected" : "Error" });
  } catch (error) {
    rows.push({ label: "Local MCP", value: "Disconnected" });
    rows.push({ label: "Detail", value: error instanceof Error ? error.message : String(error) });
  }
  rows.push({ label: "Health", value: healthUrl });
  if (active) {
    rows.push({ label: "Process", value: `PID ${active.record.pid}` });
    rows.push({ label: "Workspace", value: active.record.launchRoot ?? "unknown" });
  } else {
    rows.push({ label: "Process", value: "Not running" });
  }
  rows.push({ label: "Public MCP", value: tunnel ? `${tunnel.url}/mcp` : "Not running" });

  const local = await discoverLocalIntegrations({ pollMs: 1500 });
  const profileSet = new Set(active?.record.profiles ?? INTEGRATION_KEYS.filter((key) => config.integrations[key]));
  rows.push({
    label: "Integrations",
    value: profileSet.size > 0 ? [...profileSet].map((key) => INTEGRATION_LABELS[key]).join(", ") : "None",
  });

  if (profileSet.has("blender")) {
    const blenderConnected = local.ports.blender_lab_mcp || local.ports.auvrynt_blender_bridge;
    const blenderDetail = local.ports.blender_lab_mcp
      ? "Blender MCP connected on 9876"
      : local.ports.auvrynt_blender_bridge
      ? "Auvrynt Blender bridge connected on 49323"
      : processDetected(local, "blender")
      ? "Blender is running; waiting for MCP on 9876 or bridge on 49323"
      : "Blender is not detected";
    rows.push({ label: "Blender", value: `${blenderConnected ? "Connected" : "Offline"} - ${blenderDetail}` });
  }
  if (profileSet.has("godotGdscript") || profileSet.has("godotCsharp")) {
    const godotPlugin = getGlobalGodotPluginStatus();
    const godotConfigured = Boolean(local.executables.godot || local.executables.godotCsharp || godotPlugin.installed);
    const godotStatusText = local.ports.auvrynt_godot_bridge
      ? "connected"
      : processDetected(local, "godot")
      ? "running, bridge unavailable"
      : godotConfigured
      ? "installed, not running"
      : "not detected";
    rows.push({ label: "Godot", value: godotStatusText });
  }
  if (profileSet.has("serena")) {
    rows.push({ label: "Software", value: processDetected(local, "serena") ? "Ready" : local.executables.serena ? "Installed, not running" : "Not detected" });
  }
  if (profileSet.has("playwright")) {
    const playwright = getPlaywrightRuntimeStatus();
    rows.push({ label: "Web", value: playwright.chromiumInstalled ? "Ready" : playwright.packageInstalled ? "Installed, browser unavailable" : "Not installed" });
  }
  printConsolePanel("Auvrynt status", rows, active ? "Stop: auvrynt stop" : "Start: auvrynt start");
}



function stateDirForFiles(files: ReturnType<typeof loadAuvryntFiles>): string {
  return resolve(expandHomePath(files.config.stateDir ?? join(homedir(), ".local", "share", "auvrynt")));
}

function runToken(args: string[]): void {
  const files = loadAuvryntFiles();
  const [subcommand] = args;
  if (subcommand === "reset") {
    if (process.env.AUVRYNT_OAUTH_OWNER_TOKEN?.trim()) {
      throw new Error("Cannot reset the persisted token while AUVRYNT_OAUTH_OWNER_TOKEN is set. Remove that environment variable first.");
    }
    const token = generateOwnerToken();
    writeAuvryntAuth({ ownerToken: token });
    printConsolePanel("Owner token reset", [
      { label: "Token", value: token },
    ], "Apply it: auvrynt restart");
    return;
  }
  if (subcommand) throw new Error("Usage: auvrynt token [reset]");
  const token = process.env.AUVRYNT_OAUTH_OWNER_TOKEN?.trim() || files.auth.ownerToken?.trim();
  if (!token) throw new Error("Owner token is not configured. Run `auvrynt init` first.");
  console.log(token);
}

function runConnected(): void {
  const clients = readConnectedClients(stateDirForFiles(loadAuvryntFiles()));
  if (clients.length === 0) {
    printConsolePanel("Connected web agents", [{ label: "Status", value: "None recorded yet" }]);
    return;
  }
  const rows = clients.flatMap((client): ConsoleRow[] => [
    { label: client.provider, value: `${client.requestCount} request(s), last seen ${client.lastSeen}` },
    ...(client.userAgent ? [{ label: "User agent", value: client.userAgent }] : []),
  ]);
  printConsolePanel("Connected web agents", rows);
}

async function runUninstall(skipConfirmation: boolean): Promise<void> {
  const files = loadAuvryntFiles();
  if (!skipConfirmation) {
    if (!input.isTTY || !output.isTTY) {
      throw new Error("Uninstall is destructive in a non-interactive terminal. Re-run with `auvrynt uninstall --yes`.");
    }
    const answer = await prompts.confirm({ message: `Remove Auvrynt configuration from ${files.dir}?`, initialValue: false });
    if (prompts.isCancel(answer) || !answer) {
      printConsolePanel("Auvrynt uninstall cancelled");
      return;
    }
  }

  if (files.configExists || files.authExists) {
    rmSync(files.dir, { recursive: true, force: true });
    printConsolePanel("Auvrynt configuration removed", [
      { label: "Removed", value: files.dir },
      { label: "Preserved", value: "npm package and custom state/worktree directories" },
    ], "Remove CLI: npm uninstall -g auvrynt");
  } else {
    printConsolePanel("Auvrynt configuration", [{ label: "Status", value: "Already absent" }]);
  }
}

function runConfigCommand(args: string[]): void {
  const [subcommand, key, ...rest] = args;
  const files = loadAuvryntFiles();

  if (!subcommand || subcommand === "get") {
    console.log(JSON.stringify(files.config, null, 2));
    return;
  }

  if (subcommand !== "set") {
    throw new Error(`Unknown config command: ${subcommand}`);
  }
  if (key !== "publicBaseUrl") {
    throw new Error("Only `auvrynt config set publicBaseUrl <url|null>` is supported right now.");
  }

  const value = rest.join(" ").trim();
  if (!value) {
    throw new Error("Missing publicBaseUrl value.");
  }

  writeAuvryntConfig({
    ...files.config,
    publicBaseUrl: normalizeOptionalPublicBaseUrl(value),
  });
  console.log(`Updated ${files.configPath}`);
}

function printHelp(): void {
  console.log(
    [
      "Auvrynt",
      "",
      "Usage:",
      "  auvrynt                 Run first-time setup if needed, then start the server",
      "  auvrynt start           Start enabled integrations in the background for this directory",
      "  auvrynt start model     Start Blender MCP detection only",
      "  auvrynt start web       Start Playwright/browser tools only",
      "  auvrynt start godotcs   Start Godot C# only",
      "  auvrynt start godotgd   Start Godot GDScript only",
      "  auvrynt start se        Start Serena only",
      "  auvrynt start web,model      Start a multiple-integration combo",
      "  auvrynt start ... --replace  Live-replace profiles, or change the managed workspace",
      "  auvrynt add web         Add profiles live without restarting the server or tunnel",
      "  auvrynt stop            Stop Auvrynt and its Cloudflare tunnel",
      "  auvrynt restart [combo] Stop then start with the active integration combo",
      "  auvrynt serve           Start the server with verbose console logs",
      "  auvrynt init            Create or update ~/.auvrynt/config.json and auth.json",
      "  auvrynt setup           Configure executable paths for local tools",
      "  auvrynt enable          Enable/disable integrations one by one",
      "  auvrynt disable         Select enabled integrations to disable with number keys",
      "  auvrynt doctor          Show config, runtime, and native dependency status",
      "  auvrynt status          Show local MCP and integration connection status",
      "  auvrynt connected       Show recently connected MCP/web-agent providers",
      "  auvrynt token           Print the Owner token only on explicit local request",
      "  auvrynt token reset     Generate and save a new local Owner token",
      "  auvrynt uninstall       Remove Auvrynt configuration after confirmation",
      "  auvrynt uninstall -y    Remove Auvrynt configuration without confirmation",
      "  auvrynt config get      Print persisted config",
      "  auvrynt config set publicBaseUrl <url|null>",
      "",
      "For a custom foreground tunnel:",
      "  AUVRYNT_PUBLIC_BASE_URL=https://example.com auvrynt serve",
    ].join("\n"),
  );
}

// ─── auvrynt integration toggles ──────────────────────────────────────────────

function completeIntegrationsConfig(config: AuvryntIntegrationsConfig | undefined): Record<IntegrationKey, boolean> {
  return {
    godotGdscript: config?.godotGdscript ?? true,
    godotCsharp: config?.godotCsharp ?? true,
    blender: config?.blender ?? true,
    serena: config?.serena ?? true,
    playwright: config?.playwright ?? true,
  };
}

function writeIntegrationConfig(integrations: Record<IntegrationKey, boolean>): void {
  const files = loadAuvryntFiles();
  writeAuvryntConfig({ ...files.config, integrations });
}

async function ensureIntegrationChoicesConfigured(): Promise<void> {
  const files = loadAuvryntFiles();
  if (files.config.integrations) return;

  prompts.intro("  Auvrynt integrations  ");
  const integrations = completeIntegrationsConfig(undefined);
  for (const key of INTEGRATION_KEYS) {
    const answer = await prompts.confirm({
      message: `Enable ${INTEGRATION_LABELS[key]}?`,
      initialValue: true,
    });
    if (prompts.isCancel(answer)) {
      prompts.cancel("Integration setup cancelled.");
      process.exit(1);
    }
    integrations[key] = Boolean(answer);
  }

  writeAuvryntConfig({ ...files.config, integrations });
  prompts.outro("Saved integration choices. Change them later with `auvrynt enable` or `auvrynt disable`.");
}

async function runEnable(): Promise<void> {
  const files = loadAuvryntFiles();
  const integrations = completeIntegrationsConfig(files.config.integrations);
  prompts.intro("  Enable Auvrynt integrations  ");
  while (true) {
    prompts.note(
      ["0. Done", ...INTEGRATION_KEYS.map((key, index) => `${index + 1}. ${INTEGRATION_LABELS[key]}  ${integrations[key] ? "[enabled]" : "[disabled]"}`)].join("\n"),
      "Integrations",
    );
    const picked = await prompts.text({
      message: "Type numbers to enable, or 0 when finished",
      placeholder: "1 3 5 or 0",
      validate: (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "Enter one or more numbers, or 0.";
        const values = raw.split(/[\s,]+/).map(Number);
        if (values.includes(0)) return values.length === 1 ? undefined : "Use 0 by itself when finished.";
        if (values.some((value) => !Number.isInteger(value) || value < 1 || value > INTEGRATION_KEYS.length)) return "Use 0 or numbers from 1 to 5.";
        if (values.every((value) => integrations[INTEGRATION_KEYS[value - 1]])) return "Choose at least one disabled integration, or type 0.";
        return undefined;
      },
    });
    if (prompts.isCancel(picked)) {
      prompts.cancel("Enable cancelled.");
      return;
    }
    const values = String(picked).trim().split(/[\s,]+/).map(Number);
    if (values[0] === 0) break;
    for (const value of new Set(values)) integrations[INTEGRATION_KEYS[value - 1]] = true;
    writeIntegrationConfig(integrations);
  }
  prompts.outro("Integration settings updated. Restart any running Auvrynt server for the change to take effect.");
}

async function runDisable(): Promise<void> {
  const files = loadAuvryntFiles();
  const integrations = completeIntegrationsConfig(files.config.integrations);
  prompts.intro("  Disable Auvrynt integrations  ");
  while (true) {
    prompts.note(
      ["0. Done", ...INTEGRATION_KEYS.map((key, index) => `${index + 1}. ${INTEGRATION_LABELS[key]}  ${integrations[key] ? "[enabled]" : "[disabled]"}`)].join("\n"),
      "Integrations",
    );
    const picked = await prompts.text({
      message: "Type numbers to disable, or 0 when finished",
      placeholder: "1 3 5 or 0",
      validate: (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return "Enter one or more numbers, or 0.";
        const values = raw.split(/[\s,]+/).map(Number);
        if (values.includes(0)) return values.length === 1 ? undefined : "Use 0 by itself when finished.";
        if (values.some((value) => !Number.isInteger(value) || value < 1 || value > INTEGRATION_KEYS.length)) return "Use 0 or numbers from 1 to 5.";
        if (values.every((value) => !integrations[INTEGRATION_KEYS[value - 1]])) return "Choose at least one enabled integration, or type 0.";
        return undefined;
      },
    });
    if (prompts.isCancel(picked)) {
      prompts.cancel("Disable cancelled.");
      return;
    }
    const values = String(picked).trim().split(/[\s,]+/).map(Number);
    if (values[0] === 0) break;
    for (const value of new Set(values)) integrations[INTEGRATION_KEYS[value - 1]] = false;
    writeIntegrationConfig(integrations);
  }
  prompts.outro("Integration settings updated. Restart any running Auvrynt server for the change to take effect.");
}

// ─── auvrynt setup ────────────────────────────────────────────────────────────

const SETUP_TOOL_LABELS: Record<string, string> = {
  godot:       "Godot        - GDScript game engine",
  godotCsharp: "Godot C#     - .NET / Mono Godot build",
};

const SETUP_TOOL_KEYS = ["godot", "godotCsharp"] as const;
type SetupToolKey = (typeof SETUP_TOOL_KEYS)[number];

async function runSetup(args: string[] = []): Promise<void> {
  const files = loadAuvryntFiles();
  const existingExecs: Record<string, string | undefined> = files.config.executables ?? {};

  // Direct CLI argument support: auvrynt setup <tool> <path>
  if (args.length >= 2) {
    const targetTool = args[0].toLowerCase();
    const toolKeyMap: Record<string, SetupToolKey> = {
      godot: "godot",
      godotcsharp: "godotCsharp",
      "godot-csharp": "godotCsharp",
    };
    const key = toolKeyMap[targetTool];
    if (key) {
      const exePath = args.slice(1).join(" ").trim().replace(/^["']|["']$/g, "").trim();
      const updatedExecs = { ...existingExecs, [key]: exePath };
      writeAuvryntConfig({ ...files.config, executables: updatedExecs });
      console.log(`Updated ${key} executable path: ${exePath}`);
      return;
    }
  }

  prompts.intro("  Auvrynt Setup - configure local tool integrations  ");

  // 1. Pick which tool to configure using single-select
  const picked = await prompts.select({
    message: "Select integration to configure  (Enter to confirm)",
    options: SETUP_TOOL_KEYS.map((key) => ({
      value: key,
      label: SETUP_TOOL_LABELS[key],
      hint: existingExecs[key] ? `currently: ${existingExecs[key]}` : "not set",
    })),
  });

  if (prompts.isCancel(picked)) {
    prompts.cancel("Setup cancelled.");
    return;
  }

  const selection: SetupToolKey[] = [picked as SetupToolKey];

  // 2. Prompt for executable path for selected tool
  const updated: Record<string, string | undefined> = { ...existingExecs };

  for (const key of selection) {
    const labelName = SETUP_TOOL_LABELS[key].split(" - ")[0].trim();

    let placeholder: string;
    switch (key) {
      case "godot":
        placeholder = "e.g. C:\\Program Files\\Godot\\Godot.exe";
        break;
      case "godotCsharp":
        placeholder = "e.g. C:\\Program Files\\Godot_v4-mono\\Godot.exe  (.NET build)";
        break;
      default:
        placeholder = "";
    }

    const answer = await prompts.text({
      message: `${labelName} executable path`,
      placeholder,
      initialValue: existingExecs[key] ?? "",
      validate: (val) => {
        if (!(val ?? "").trim()) return "Path cannot be empty.";
        return undefined;
      },
    });

    if (prompts.isCancel(answer)) {
      prompts.cancel("Setup cancelled.");
      return;
    }

    updated[key] = (answer as string).trim().replace(/^["']|["']$/g, "").trim();
  }


  // 3. Persist to ~/.auvrynt/config.json
  writeAuvryntConfig({
    ...files.config,
    executables: {
      ...files.config.executables,
      godot:       updated.godot,
      godotCsharp: updated.godotCsharp,
    },
  });

  // Automatically install global Godot Editor plugin
  const pluginResult = ensureGlobalGodotPlugin();
  if (pluginResult.installed) {
    prompts.log.success(`Installed global Godot Editor plugin: ${pluginResult.targetPath}`);
  }

  // 4. Show summary
  prompts.note(
    selection
      .map((key) => `${SETUP_TOOL_LABELS[key].split(" - ")[0].trim().padEnd(14)} -> ${updated[key]}`)
      .join("\n"),
    "Saved to ~/.auvrynt/config.json",
  );

  prompts.outro("Setup complete. Run `auvrynt status` to verify.");
}




function normalizeOptionalPublicBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "none") return null;

  return normalizePublicBaseUrl(trimmed);
}

function normalizePublicBaseUrl(value: string): string {
  const trimmed = value.trim();
  const parsed = new URL(trimmed);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

type TextPromptOptions = Omit<Parameters<typeof prompts.text>[0], "validate"> & {
  defaultValue: string;
  validate?: (value: string | undefined) => string | Error | undefined;
};

async function textPrompt(options: TextPromptOptions): Promise<string> {
  const result = await prompts.text({
    ...options,
    validate: (value) => options.validate?.(value?.trim() ? value : options.defaultValue),
  });
  if (prompts.isCancel(result)) throw new SetupCancelledError();
  const value = String(result).trim();
  return value || options.defaultValue;
}

function validatePort(value: string | undefined): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? undefined
    : "Enter a port between 1 and 65535.";
}

function validateRequiredPublicBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "Enter the public URL from your tunnel or reverse proxy.";
  if (trimmed.endsWith("/mcp")) return "Enter the base URL only, without /mcp.";
  return validatePublicBaseUrl(trimmed);
}

function validatePublicBaseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? undefined
      : "Use an http or https URL.";
  } catch {
    return "Enter a valid URL, for example https://your-tunnel-host.example.com.";
  }
}

function assertSupportedNode(): void {
  if (satisfies(process.versions.node, SUPPORTED_NODE_RANGE)) return;

  throw new Error(
    [
      `Auvrynt requires Node ${SUPPORTED_NODE_RANGE}.`,
      `Current Node: ${process.version}`,
      "",
      "Install Node 22 LTS or use a version manager such as nvm, fnm, or mise.",
    ].join("\n"),
  );
}

function nodeVersionStatus(): string {
  return satisfies(process.versions.node, SUPPORTED_NODE_RANGE)
    ? `supported ${SUPPORTED_NODE_RANGE}`
    : `unsupported, requires ${SUPPORTED_NODE_RANGE}`;
}

class SetupCancelledError extends Error {}

function checkSqliteNative(): string {
  try {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
    return "ok";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function checkGitAvailable(): string {
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    return execFileSync("git", ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `unavailable (${message})`;
  }
}

function checkBashShell(): string {
  try {
    const { shell, args } = getShellConfig();
    return `${shell} ${args.join(" ")}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `unavailable (${message})`;
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
