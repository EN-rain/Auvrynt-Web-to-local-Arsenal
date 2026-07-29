import * as prompts from "@clack/prompts";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { readConnectedClients } from "../../connection-registry.js";
import { expandHomePath } from "../../roots.js";
import {
  generateOwnerToken,
  loadAuvryntFiles,
  writeAuvryntAuth,
  writeAuvryntConfig,
} from "../../user-config.js";
import { printConsolePanel, type ConsoleRow } from "../runtime-support.js";

function stateDirForFiles(files: ReturnType<typeof loadAuvryntFiles>): string {
  return resolve(expandHomePath(files.config.stateDir ?? join(homedir(), ".local", "share", "auvrynt")));
}

function normalizePublicBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Public base URL must use http:// or https://.");
  if (url.username || url.password) throw new Error("Public base URL must not contain credentials.");
  if (url.search || url.hash) throw new Error("Public base URL must not contain a query string or fragment.");
  if (url.pathname !== "/") throw new Error("Public base URL must be an origin only, without a path such as /mcp.");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Public base URL must use HTTPS unless it targets localhost/loopback.");
  }
  return url.origin;
}

function normalizeOptionalPublicBaseUrl(value: string): string | null {
  if (["null", "none", "clear"].includes(value.toLowerCase())) return null;
  return normalizePublicBaseUrl(value);
}

export function runTokenCommand(args: string[]): void {
  const files = loadAuvryntFiles();
  const [subcommand] = args;
  if (subcommand === "reset") {
    if (process.env.AUVRYNT_OAUTH_OWNER_TOKEN?.trim()) {
      throw new Error("Cannot reset the persisted token while AUVRYNT_OAUTH_OWNER_TOKEN is set. Remove that environment variable first.");
    }
    const token = generateOwnerToken();
    writeAuvryntAuth({ ownerToken: token });
    rmSync(join(stateDirForFiles(files), "oauth-state.json"), { force: true });
    printConsolePanel("Owner token reset", [{ label: "Token", value: token }], "Apply it: auvrynt restart");
    return;
  }
  if (subcommand) throw new Error("Usage: auvrynt token [reset]");
  const token = process.env.AUVRYNT_OAUTH_OWNER_TOKEN?.trim() || files.auth.ownerToken?.trim();
  if (!token) throw new Error("Owner token is not configured. Run `auvrynt init` first.");
  console.log(token);
}

export function runConnectedCommand(): void {
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

export async function runUninstallCommand(skipConfirmation: boolean): Promise<void> {
  const files = loadAuvryntFiles();
  if (!skipConfirmation) {
    if (!stdin.isTTY || !stdout.isTTY) {
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

export function runConfigCommand(args: string[]): void {
  const [subcommand, key, ...rest] = args;
  const files = loadAuvryntFiles();
  if (!subcommand || subcommand === "get") {
    console.log(JSON.stringify(files.config, null, 2));
    return;
  }
  if (subcommand !== "set") throw new Error(`Unknown config command: ${subcommand}`);
  if (key !== "publicBaseUrl") {
    throw new Error("Only `auvrynt config set publicBaseUrl <url|null>` is supported right now.");
  }
  const value = rest.join(" ").trim();
  if (!value) throw new Error("Missing publicBaseUrl value.");
  writeAuvryntConfig({ ...files.config, publicBaseUrl: normalizeOptionalPublicBaseUrl(value) });
  console.log(`Updated ${files.configPath}`);
}
