#!/usr/bin/env node
import { createRequire } from "node:module";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import { existsSync, rmSync } from "node:fs";
import { mkdir, open, readFile, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
  type AuvryntUserConfig,
} from "./user-config.js";
import { expandHomePath } from "./roots.js";
import { discoverLocalIntegrations, processDetected } from "./integration-discovery.js";
import { readConnectedClients } from "./connection-registry.js";
import { ensureGlobalGodotPlugin } from "./godot-tools.js";


type Command = "serve" | "init" | "doctor" | "status" | "connected" | "uninstall" | "config" | "setup" | "help";
const require = createRequire(import.meta.url);
const SUPPORTED_NODE_RANGE = ">=20.12 <27";

async function main(argv: string[]): Promise<void> {
  assertSupportedNode();

  const [rawCommand, ...args] = argv;
  const command = normalizeCommand(rawCommand);

  switch (command) {
    case "serve":
      if (rawCommand === "start") {
        // `start` is intentionally directory-scoped: the launch directory is
        // the only project root available to the web agent for this session.
        const launchRoot = resolve(process.cwd());
        process.env.AUVRYNT_ALLOWED_ROOTS = launchRoot;
        process.env.AUVRYNT_WORKTREE_ROOT = launchRoot;
      }
      await ensureConfigured({ directoryScoped: rawCommand === "start" });
      const localConfig = loadConfig();
      const instanceLock = await acquireInstanceLock(localConfig.stateDir);
      let tunnel: { process: ChildProcess; url: string } | undefined;
      let stopTunnel: (() => void) | undefined;
      try {
        if (rawCommand === "start") {
          process.env.AUVRYNT_START_MODE = "true";
          process.env.AUVRYNT_SERENA_ENABLED = "true";
          process.env.AUVRYNT_SERENA_EXECUTABLE = await ensureSerenaExecutable();
          tunnel = await startCloudflareTunnel(localConfig.port);
          process.env.AUVRYNT_PUBLIC_BASE_URL = tunnel.url;
          stopTunnel = () => {
            if (tunnel && !tunnel.process.killed) tunnel.process.kill();
          };
          process.once("SIGINT", stopTunnel);
          process.once("SIGTERM", stopTunnel);
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
    case "uninstall":
      await runUninstall(args.includes("--yes") || args.includes("-y"));
      return;
    case "config":
      runConfigCommand(args);
      return;
    case "setup":
      await runSetup(args.slice(1));
      return;
    case "help":
      printHelp();
      return;
  }
}

function normalizeCommand(command: string | undefined): Command {
  if (!command || command === "serve" || command === "start") return "serve";
  if (command === "init" || command === "doctor" || command === "config") return command;
  if (command === "status" || command === "connected" || command === "uninstall") return command;
  if (command === "setup") return "setup";
  if (command === "help" || command === "--help" || command === "-h") return "help";
  throw new Error(`Unknown command: ${command}`);
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
      `Local MCP URL: http://${config.host}:${config.port}/mcp`,
      ...(publicBaseUrl ? [`Public MCP URL: ${publicBaseUrl}/mcp`] : []),
    ];
    prompts.note(lines.join("\n"), "Auvrynt configured");
    prompts.note(
      [
        `Owner password: ${auth.ownerToken}`,
        "Use this when ChatGPT or Claude asks you to approve Auvrynt access.",
        `Stored at: ${authPath}`,
      ].join("\n"),
      "Owner password",
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
  const { app } = createServer(config);

  const startMode = process.env.AUVRYNT_START_MODE === "true";
  const files = loadAuvryntFiles();
  const ownerToken = files.auth.ownerToken || "not_configured";
  const publicMcpUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, "")}/mcp`
    : `http://${config.host}:${config.port}/mcp`;

  const godotPlugin = ensureGlobalGodotPlugin();
  const godotIsSetup = Boolean(config.executables.godot || config.executables.godotCsharp);

  await new Promise<void>((resolveServer, rejectServer) => {
    const httpServer = app.listen(config.port, config.host, () => {
    if (startMode) {
      console.clear();
      console.log("");
      console.log("  \x1b[36m\x1b[1mAuvrynt: Webkit Arsenal is ready\x1b[0m");
      if (godotIsSetup || godotPlugin.installed) {
        console.log("  \x1b[32m\x1b[1mGodot OK\x1b[0m (Global Auvrynt Bridge plugin installed)");
      }
      console.log("");

      console.log("  \x1b[90mWeb Agent connector URL:\x1b[0m");
      console.log("    \x1b[36m" + publicMcpUrl + "\x1b[0m");
      console.log("");
      console.log("  \x1b[90mAuthorization page:\x1b[0m");
      console.log("    \x1b[36m" + config.publicBaseUrl.replace(/\/$/, "") + "/authorize\x1b[0m");
      console.log("");
      console.log("  \x1b[90mOwner token:\x1b[0m");
      console.log("    \x1b[33m" + ownerToken + "\x1b[0m");
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
      console.log(`auvrynt listening on http://${config.host}:${config.port}/mcp`);
      console.log(`public base url: ${config.publicBaseUrl}`);
      console.log(`allowed roots: ${config.allowedRoots.join(", ")}`);
      console.log(`allowed hosts: ${config.allowedHosts.join(", ")}`);
      if (config.allowedHosts.includes("*")) {
        console.warn("warning: Host header allowlist is disabled because AUVRYNT_ALLOWED_HOSTS=*");
      }
      console.log("auth: Owner password approval required");
      console.log(`logging: ${config.logging.level} ${config.logging.format}`);
    }
  });

    const removeSignalHandlers = () => {
      process.removeListener("SIGINT", shutdown);
      process.removeListener("SIGTERM", shutdown);
    };
    const shutdown = () => {
      if ((global as any).auvryntStartInterval) {
        clearInterval((global as any).auvryntStartInterval);
        delete (global as any).auvryntStartInterval;
      }
      httpServer.close(() => {
        removeSignalHandlers();
        resolveServer();
      });
    };
    httpServer.once("error", (error) => {
      removeSignalHandlers();
      rejectServer(error);
    });
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

async function runDoctor(): Promise<void> {
  const files = loadAuvryntFiles();
  console.log(`Config dir: ${files.dir}`);
  console.log(`Config file: ${files.configExists ? files.configPath : "missing"}`);
  console.log(`Auth file: ${files.authExists ? files.authPath : "missing"}`);
  console.log(`Node: ${process.version} (${nodeVersionStatus()})`);
  console.log(`Node ABI: ${process.versions.modules}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Git: ${checkGitAvailable()}`);
  console.log(`Bash shell: ${checkBashShell()}`);
  console.log(`SQLite native dependency: ${checkSqliteNative()}`);

  try {
    const config = loadConfig();
    console.log(`Local MCP URL: http://${config.host}:${config.port}/mcp`);
    console.log(`Public MCP URL: ${new URL("/mcp", config.publicBaseUrl).toString()}`);
    console.log(`Allowed roots: ${config.allowedRoots.join(", ")}`);
    console.log(`Allowed hosts: ${config.allowedHosts.join(", ")}`);
  } catch (error) {
    console.log(`Config status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function acquireInstanceLock(stateDir: string): Promise<{ release: () => Promise<void> }> {
  const lockPath = join(stateDir, "server.lock");
  await mkdir(stateDir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      return { release: () => releaseInstanceLock(handle, lockPath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

      let ownerPid: number | undefined;
      try {
        const lock = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: number };
        ownerPid = lock.pid;
      } catch {
        // A partially written lock is treated as stale and retried once.
      }

      if (ownerPid && isProcessRunning(ownerPid)) {
        throw new Error(`Auvrynt is already running (PID ${ownerPid}). Stop that instance before starting another.`);
      }

      await unlink(lockPath).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      });
    }
  }

  throw new Error("Could not acquire the Auvrynt server lock.");
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function releaseInstanceLock(handle: FileHandle, lockPath: string): Promise<void> {
  await handle.close().catch(() => undefined);
  await unlink(lockPath).catch(() => undefined);
}

async function startCloudflareTunnel(port: number): Promise<{ process: ChildProcess; url: string }> {
  const executable = await resolveCloudflaredExecutable();
  const child = spawn(executable, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const tunnelUrl = await new Promise<string>((resolveUrl, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Cloudflare tunnel did not provide a public URL within 30 seconds."));
    }, 30_000);
    const onOutput = (chunk: Buffer | string) => {
      output += chunk.toString();
      const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolveUrl(match[0]);
      }
    };
    child.stdout?.on("data", onOutput);
    child.stderr?.on("data", onOutput);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Cloudflare tunnel failed to start: ${error.message}`));
    });
    child.once("exit", (code) => {
      if (code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Cloudflare tunnel exited before connecting (code ${code}).`));
      }
    });
  });

  return { process: child, url: tunnelUrl };
}

async function resolveCloudflaredExecutable(): Promise<string> {
  try {
    return execFileSync(
      process.platform === "win32" ? "where.exe" : "which",
      ["cloudflared"],
      { encoding: "utf8" },
    ).split(/\r?\n/)[0]?.trim() || "cloudflared";
  } catch {
    if (process.platform === "win32") {
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
      { encoding: "utf8" },
    ).split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function ensureSerenaExecutable(): Promise<string> {
  const existing = findCommand("serena");
  if (existing) return existing;

  const projectRoot = resolve(process.cwd());
  const localCandidates = [
    join(projectRoot, "serena"),
    join(dirname(projectRoot), "serena"),
    join(homedir(), "Desktop", "Projectsss", "serena"),
  ];
  const localSource = localCandidates.find((candidate) => existsSync(join(candidate, "pyproject.toml")));
  const uv = await ensureUvExecutable();

  console.log(localSource
    ? `Serena is not installed; installing the local checkout from ${localSource}...`
    : "Serena is not installed; installing the official Serena package...");
  const installArgs = localSource
    ? ["tool", "install", "--force", "--editable", localSource]
    : ["tool", "install", "--force", "serena-agent"];
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
  console.log("uv is not installed; installing it for Serena...");
  execFileSync(python, ["-m", "pip", "install", "--user", "uv"], { stdio: "inherit" });

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
  const downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/${artifact}`;

  console.log("cloudflared is not installed; downloading the official Windows binary...");
  const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Could not download cloudflared (HTTP ${response.status}). Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/.`);
  }
  await mkdir(targetDir, { recursive: true });
  await writeFile(executable, Buffer.from(await response.arrayBuffer()), { mode: 0o755 });
  return executable;
}

async function runStatus(): Promise<void> {
  const files = loadAuvryntFiles();
  const host = files.config.host ?? "127.0.0.1";
  const port = files.config.port ?? 49321;
  const healthUrl = `http://${host}:${port}/healthz`;

  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; name?: string };
    console.log(`Local MCP: ${response.ok && body.ok ? "connected" : "error"}`);
    console.log(`Health URL: ${healthUrl}`);
  } catch (error) {
    console.log("Local MCP: disconnected");
    console.log(`Health URL: ${healthUrl}`);
    console.log(`Detail: ${error instanceof Error ? error.message : String(error)}`);
  }

  const local = await discoverLocalIntegrations();
  const godotPlugin = ensureGlobalGodotPlugin();
  const godotConfigured = Boolean(local.executables.godot || local.executables.godotCsharp || godotPlugin.installed);
  const godotRunning = processDetected(local, "godot");
  const godotStatusText = local.ports.auvrynt_godot_bridge
    ? "OK (Auvrynt bridge connected)"
    : godotRunning
    ? "OK (running)"
    : godotConfigured
    ? "OK"
    : "not detected";

  console.log(`Blender MCP (9876): ${local.ports.blender_lab_mcp ? "connected" : processDetected(local, "blender") ? "running, MCP unavailable" : "not detected"}`);
  console.log(`Godot: ${godotStatusText}`);
  if (local.executables.godotCsharp) console.log(`Godot C#: configured`);
  console.log(`Cloudflare Tunnel: ${processDetected(local, "cloudflare_tunnel") ? "running" : local.executables.cloudflared ? "installed, not running" : "not installed"}`);
  console.log(`Serena: ${processDetected(local, "serena") ? "running" : local.executables.serena ? "installed" : "not installed"}`);
}



function stateDirForFiles(files: ReturnType<typeof loadAuvryntFiles>): string {
  return resolve(expandHomePath(files.config.stateDir ?? join(homedir(), ".local", "share", "auvrynt")));
}

function runConnected(): void {
  const clients = readConnectedClients(stateDirForFiles(loadAuvryntFiles()));
  console.log("Connected web agents:");
  if (clients.length === 0) {
    console.log("  none recorded yet");
    return;
  }

  for (const client of clients) {
    console.log(`  ${client.provider} — ${client.requestCount} request(s), last seen ${client.lastSeen}`);
    if (client.userAgent) console.log(`    user-agent: ${client.userAgent}`);
  }
}

async function runUninstall(skipConfirmation: boolean): Promise<void> {
  const files = loadAuvryntFiles();
  if (!skipConfirmation) {
    if (!input.isTTY || !output.isTTY) {
      throw new Error("Uninstall is destructive in a non-interactive terminal. Re-run with `auvrynt uninstall --yes`.");
    }
    const answer = await prompts.confirm({ message: `Remove Auvrynt configuration from ${files.dir}?`, initialValue: false });
    if (prompts.isCancel(answer) || !answer) {
      console.log("Uninstall cancelled.");
      return;
    }
  }

  if (files.configExists || files.authExists) {
    rmSync(files.dir, { recursive: true, force: true });
    console.log(`Removed Auvrynt configuration: ${files.dir}`);
  } else {
    console.log("Auvrynt configuration was already absent.");
  }
  console.log("The npm CLI package remains installed. Remove it with: npm uninstall -g auvrynt");
  console.log("Custom state/worktree directories were preserved.");
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
      "  auvrynt start           Start a Cloudflare tunnel scoped to the current directory",
      "  auvrynt serve           Start the server with verbose console logs",
      "  auvrynt init            Create or update ~/.auvrynt/config.json and auth.json",
      "  auvrynt setup           Configure tool integrations (Serena, Godot, Blender...)",
      "  auvrynt doctor          Show config, runtime, and native dependency status",
      "  auvrynt status          Show local MCP and integration connection status",
      "  auvrynt connected       Show recently connected MCP/web-agent providers",
      "  auvrynt uninstall       Remove Auvrynt configuration after confirmation",
      "  auvrynt uninstall -y    Remove Auvrynt configuration without confirmation",
      "  auvrynt config get      Print persisted config",
      "  auvrynt config set publicBaseUrl <url|null>",
      "",
      "For temporary tunnels:",
      "  AUVRYNT_PUBLIC_BASE_URL=https://example.trycloudflare.com auvrynt start",
    ].join("\n"),
  );
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
    return execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
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
