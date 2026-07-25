#!/usr/bin/env node
import { createRequire } from "node:module";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
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

type Command = "serve" | "init" | "doctor" | "status" | "connected" | "uninstall" | "config" | "help";
const require = createRequire(import.meta.url);
const SUPPORTED_NODE_RANGE = ">=20.12 <27";

async function main(argv: string[]): Promise<void> {
  assertSupportedNode();

  const [rawCommand, ...args] = argv;
  const command = normalizeCommand(rawCommand);

  switch (command) {
    case "serve":
      await ensureConfigured();
      if (rawCommand === "start") {
        process.env.AUVRYNT_START_MODE = "true";
      }
      await serve();
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
    case "help":
      printHelp();
      return;
  }
}

function normalizeCommand(command: string | undefined): Command {
  if (!command || command === "serve" || command === "start") return "serve";
  if (command === "init" || command === "doctor" || command === "config") return command;
  if (command === "status" || command === "connected" || command === "uninstall") return command;
  if (command === "help" || command === "--help" || command === "-h") return "help";
  throw new Error(`Unknown command: ${command}`);
}

async function ensureConfigured(): Promise<void> {
  const files = loadAuvryntFiles();
  if (files.configExists && files.authExists) return;
  if (process.env.AUVRYNT_OAUTH_OWNER_TOKEN) return;

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
    prompts.outro("Run `auvrynt serve` to start the MCP server.");
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

  const httpServer = app.listen(config.port, config.host, () => {
    if (startMode) {
      console.clear();
      console.log("Auvrynt is running!");
      console.log("");
      console.log(`  Public URL:     \x1b[36m${publicMcpUrl}\x1b[0m`);
      console.log(`  Owner Password: \x1b[33m${ownerToken}\x1b[0m`);
      console.log("");
      console.log("  # CTRL + C to stop");
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

  const shutdown = () => {
    if ((global as any).auvryntStartInterval) {
      clearInterval((global as any).auvryntStartInterval);
    }
    httpServer.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
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
  console.log(`Blender MCP (9876): ${local.ports.blender_lab_mcp ? "connected" : processDetected(local, "blender") ? "running, MCP unavailable" : "not detected"}`);
  console.log(`Godot: ${local.ports.auvrynt_godot_bridge ? "Auvrynt bridge connected" : processDetected(local, "godot") ? "running, bridge unavailable" : "not detected"}`);
  console.log(`Cloudflare Tunnel: ${processDetected(local, "cloudflare_tunnel") ? "running" : local.executables.cloudflared ? "installed, not running" : "not installed"}`);
  console.log(`Serena: ${processDetected(local, "serena") ? "running" : local.executables.serena ? "installed, on demand" : "not installed"}`);
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
      "  auvrynt start           Start the server with an animated logs indicator (clean UI)",
      "  auvrynt serve           Start the server with verbose console logs",
      "  auvrynt init            Create or update ~/.auvrynt/config.json and auth.json",
      "  auvrynt doctor          Show config, runtime, and native dependency status",
      "  auvrynt status          Show local MCP and integration connection status",
      "  auvrynt connected       Show recently connected MCP/web-agent providers",
      "  auvrynt uninstall       Remove Auvrynt configuration after confirmation",
      "  auvrynt uninstall -y    Remove Auvrynt configuration without confirmation",
      "  auvrynt config get      Print persisted config",
      "  auvrynt config set publicBaseUrl <url|null>",
      "",
      "For temporary tunnels:",
      "  AUVRYNT_PUBLIC_BASE_URL=https://example.trycloudflare.com auvrynt serve",
    ].join("\n"),
  );
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
