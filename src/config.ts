import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHomePath } from "./roots.js";
import type { LoggingConfig, LogFormat, LogLevel } from "./logger.js";
import type { OAuthConfig } from "./oauth-provider.js";
import { loadAuvryntFiles, type AuvryntUserConfig, type AuvryntExecutablesConfig } from "./user-config.js";

export type ToolNamingMode = "legacy" | "short";
export type WidgetMode = "off" | "changes" | "full";
const DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const SUPPORTED_SCOPES = [
  "auvrynt:read",
  "auvrynt:write",
  "auvrynt:process",
  "auvrynt:web",
  "auvrynt:software",
  "auvrynt:godot",
  "auvrynt:blender",
  "auvrynt:serena",
] as const;

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "auvrynt:read": "Inspect files, search, and perform read-only project analysis",
  "auvrynt:write": "Edit and create files",
  "auvrynt:process": "Start and stop approved workspace processes",
  "auvrynt:web": "Use browser and web-development tools",
  "auvrynt:software": "Use software and .NET tools",
  "auvrynt:godot": "Use Godot project tools",
  "auvrynt:blender": "Use Blender 3D tools",
  "auvrynt:serena": "Use local Serena semantic code tools",
};

export interface SerenaServerConfig {
  enabled: boolean;
  executable: string;
  backend: "LSP" | "JetBrains";
  context: string;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  idleTimeoutMinutes: number;
  maxInstances: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  oauth: OAuthConfig;
  allowedRoots: string[];
  allowedHosts: string[];
  publicBaseUrl: string;
  minimalTools: boolean;
  toolNaming: ToolNamingMode;
  widgets: WidgetMode;
  stateDir: string;
  worktreeRoot: string;
  skillsEnabled: boolean;
  skillPaths: string[];
  agentDir: string;
  logging: LoggingConfig;
  serena: SerenaServerConfig;
  executables: AuvryntExecutablesConfig;
}

function parsePort(value: string | number | undefined): number {
  if (value === undefined || value === "") return 49321;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  return port;
}

function parseAllowedRoots(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    const roots = value.map((entry) => entry.trim()).filter(Boolean);
    return (roots.length > 0 ? roots : [process.cwd()]).map((root) => resolve(expandHomePath(root)));
  }

  const rawRoots =
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];

  const roots = rawRoots.length > 0 ? rawRoots : [process.cwd()];
  return roots.map((root) => resolve(expandHomePath(root)));
}

function parseAllowedHosts(value: string | string[] | undefined, derivedHosts: string[]): string[] {
  if (Array.isArray(value)) {
    return normalizeAllowedHosts(value, derivedHosts);
  }

  const rawHosts =
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? [];

  return normalizeAllowedHosts(rawHosts, derivedHosts);
}

function normalizeAllowedHosts(rawHosts: string[], derivedHosts: string[]): string[] {
  const hosts = rawHosts.length > 0 ? rawHosts : derivedHosts;
  if (hosts.includes("*")) return ["*"];
  return Array.from(new Set(hosts.map((host) => host.trim()).filter(Boolean)));
}

function parseBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.toLowerCase() ?? "");
}

function parseMinimalTools(env: NodeJS.ProcessEnv): boolean {
  if (env.AUVRYNT_TOOL_MODE === "minimal") return true;
  if (env.AUVRYNT_TOOL_MODE === "full") return false;
  if (env.AUVRYNT_TOOL_MODE) {
    throw new Error(`Invalid AUVRYNT_TOOL_MODE: ${env.AUVRYNT_TOOL_MODE}`);
  }
  if (env.AUVRYNT_MINIMAL_TOOLS !== undefined) return parseBoolean(env.AUVRYNT_MINIMAL_TOOLS);
  return true;
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (!value || value === "info") return "info";
  if (["silent", "error", "warn", "debug"].includes(value)) return value as LogLevel;

  throw new Error(`Invalid AUVRYNT_LOG_LEVEL: ${value}`);
}

function parseLogFormat(value: string | undefined): LogFormat {
  if (!value || value === "json") return "json";
  if (value === "pretty") return "pretty";

  throw new Error(`Invalid AUVRYNT_LOG_FORMAT: ${value}`);
}

function parsePathList(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => resolve(expandHomePath(entry))) ?? []
  );
}

function parseStringList(value: string | undefined, fallback: string[]): string[] {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries && entries.length > 0 ? entries : fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}: ${value}`);
  }

  return parsed;
}

function parseToolNaming(value: string | undefined): ToolNamingMode {
  if (!value || value === "short") return "short";
  if (value === "legacy") return "legacy";

  throw new Error(`Invalid AUVRYNT_TOOL_NAMING: ${value}`);
}

function parseLoggingConfig(env: NodeJS.ProcessEnv): LoggingConfig {
  return {
    level: parseLogLevel(env.AUVRYNT_LOG_LEVEL),
    format: parseLogFormat(env.AUVRYNT_LOG_FORMAT),
    requests: env.AUVRYNT_LOG_REQUESTS === undefined ? true : parseBoolean(env.AUVRYNT_LOG_REQUESTS),
    assets: parseBoolean(env.AUVRYNT_LOG_ASSETS),
    toolCalls: env.AUVRYNT_LOG_TOOL_CALLS === undefined ? true : parseBoolean(env.AUVRYNT_LOG_TOOL_CALLS),
    shellCommands: parseBoolean(env.AUVRYNT_LOG_SHELL_COMMANDS),
    trustProxy: parseBoolean(env.AUVRYNT_TRUST_PROXY),
  };
}

function parseWidgetMode(value: string | undefined): WidgetMode {
  if (!value || value === "full") return "full";
  if (value === "off" || value === "changes") return value;

  throw new Error(`Invalid AUVRYNT_WIDGETS: ${value}`);
}

function parseRequiredSecret(value: string | undefined, name: string): string {
  const secret = value?.trim();
  if (!secret) {
    throw new Error(`${name} is required for Auvrynt OAuth. Run: auvrynt init`);
  }
  if (secret.length < 16) {
    throw new Error(`${name} must be at least 16 characters long.`);
  }
  return secret;
}

function parseOAuthConfig(env: NodeJS.ProcessEnv, ownerToken: string | undefined): OAuthConfig {
  return {
    ownerToken: parseRequiredSecret(env.AUVRYNT_OAUTH_OWNER_TOKEN ?? ownerToken, "AUVRYNT_OAUTH_OWNER_TOKEN"),
    accessTokenTtlSeconds: parsePositiveInteger(
      env.AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      "AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS",
    ),
    refreshTokenTtlSeconds: parsePositiveInteger(
      env.AUVRYNT_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS,
      "AUVRYNT_OAUTH_REFRESH_TOKEN_TTL_SECONDS",
    ),
    scopes: parseStringList(env.AUVRYNT_OAUTH_SCOPES, [...SUPPORTED_SCOPES]),
    allowedRedirectHosts: parseStringList(env.AUVRYNT_OAUTH_ALLOWED_REDIRECT_HOSTS, [
      "chatgpt.com",
      "claude.ai",
      "claude.com",
      "localhost",
      "127.0.0.1",
    ]),
  };
}

function defaultStateDir(): string {
  return join(homedir(), ".local", "share", "auvrynt");
}

function defaultWorktreeRoot(): string {
  return join(homedir(), ".auvrynt", "worktrees");
}

function defaultAgentDir(): string {
  return join(homedir(), ".codex");
}

function parseSerenaConfig(env: NodeJS.ProcessEnv, filesConfig: AuvryntUserConfig): SerenaServerConfig {
  const filesSerena = (filesConfig as any).serena ?? {};
  return {
    enabled: parseBoolean(env.AUVRYNT_SERENA_ENABLED ?? filesSerena.enabled),
    executable: env.AUVRYNT_SERENA_EXECUTABLE ?? env.AUVRYNT_SERENA_PATH ?? filesConfig.executables?.serena ?? filesSerena.executable ?? "serena",
    backend: (env.AUVRYNT_SERENA_BACKEND ?? filesSerena.backend ?? "LSP") as "LSP" | "JetBrains",
    context: env.AUVRYNT_SERENA_CONTEXT ?? filesSerena.context ?? "desktop-app",
    startupTimeoutMs: parsePositiveInteger(
      env.AUVRYNT_SERENA_STARTUP_TIMEOUT ?? filesSerena.startupTimeoutMs, 30_000, "AUVRYNT_SERENA_STARTUP_TIMEOUT",
    ),
    requestTimeoutMs: parsePositiveInteger(
      env.AUVRYNT_SERENA_REQUEST_TIMEOUT ?? filesSerena.requestTimeoutMs, 60_000, "AUVRYNT_SERENA_REQUEST_TIMEOUT",
    ),
    idleTimeoutMinutes: parsePositiveInteger(
      env.AUVRYNT_SERENA_IDLE_TIMEOUT ?? filesSerena.idleTimeoutMinutes, 30, "AUVRYNT_SERENA_IDLE_TIMEOUT",
    ),
    maxInstances: parsePositiveInteger(
      env.AUVRYNT_SERENA_MAX_INSTANCES ?? filesSerena.maxInstances, 3, "AUVRYNT_SERENA_MAX_INSTANCES",
    ),
  };
}

function cleanExecutablePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/^["']|["']$/g, "").trim();
  return trimmed || undefined;
}

function parseExecutablesConfig(env: NodeJS.ProcessEnv, filesConfig: AuvryntUserConfig): AuvryntExecutablesConfig {
  const configExecs = filesConfig.executables ?? {};
  return {
    serena: cleanExecutablePath(env.AUVRYNT_SERENA_PATH ?? configExecs.serena),
    godot: cleanExecutablePath(env.AUVRYNT_GODOT_PATH ?? configExecs.godot),
    godotCsharp: cleanExecutablePath(env.AUVRYNT_GODOT_CSHARP_PATH ?? configExecs.godotCsharp),
    blender: cleanExecutablePath(env.AUVRYNT_BLENDER_PATH ?? configExecs.blender),
  };
}


export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const files = loadAuvryntFiles(env);
  const host = env.HOST ?? files.config.host ?? "127.0.0.1";
  const port = parsePort(env.PORT ?? files.config.port);
  const publicBaseUrl = parsePublicBaseUrl(
    env.AUVRYNT_PUBLIC_BASE_URL ?? files.config.publicBaseUrl ?? localPublicBaseUrl(host, port),
  );
  const derivedAllowedHosts = [
    "localhost",
    "127.0.0.1",
    "::1",
    host,
    new URL(publicBaseUrl).hostname,
    ...(files.config.allowedHosts ?? []),
  ];

  return {
    host,
    port,
    oauth: parseOAuthConfig(env, files.auth.ownerToken),
    allowedRoots: parseAllowedRoots(env.AUVRYNT_ALLOWED_ROOTS ?? files.config.allowedRoots),
    allowedHosts: parseAllowedHosts(env.AUVRYNT_ALLOWED_HOSTS, derivedAllowedHosts),
    publicBaseUrl,
    minimalTools: parseMinimalTools(env),
    toolNaming: parseToolNaming(env.AUVRYNT_TOOL_NAMING),
    widgets: parseWidgetMode(env.AUVRYNT_WIDGETS),
    stateDir: resolve(expandHomePath(env.AUVRYNT_STATE_DIR ?? files.config.stateDir ?? defaultStateDir())),
    worktreeRoot: resolve(expandHomePath(env.AUVRYNT_WORKTREE_ROOT ?? files.config.worktreeRoot ?? defaultWorktreeRoot())),
    skillsEnabled: env.AUVRYNT_SKILLS === undefined ? true : parseBoolean(env.AUVRYNT_SKILLS),
    skillPaths: parsePathList(env.AUVRYNT_SKILL_PATHS),
    agentDir: resolve(expandHomePath(env.AUVRYNT_AGENT_DIR ?? files.config.agentDir ?? defaultAgentDir())),
    logging: parseLoggingConfig(env),
    serena: parseSerenaConfig(env, files.config),
    executables: parseExecutablesConfig(env, files.config),
  };
}

function parsePublicBaseUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function localPublicBaseUrl(host: string, port: number): string {
  const publicHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const formattedHost = publicHost.includes(":") && !publicHost.startsWith("[")
    ? `[${publicHost}]`
    : publicHost;
  return `http://${formattedHost}:${port}`;
}
