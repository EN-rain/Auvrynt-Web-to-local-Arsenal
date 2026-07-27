import { isIP } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHomePath } from "./roots.js";
import type { LoggingConfig, LogFormat, LogLevel } from "./logger.js";
import type { OAuthConfig } from "./oauth-provider.js";
import { loadAuvryntFiles, type AuvryntUserConfig, type AuvryntExecutablesConfig, type AuvryntIntegrationsConfig } from "./user-config.js";

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
  "auvrynt:blender-python",
  "auvrynt:serena",
] as const;

export type AuvryntScope = (typeof SUPPORTED_SCOPES)[number];

const DEFAULT_OAUTH_SCOPES: AuvryntScope[] = SUPPORTED_SCOPES.filter(
  (scope): scope is AuvryntScope => scope !== "auvrynt:blender-python",
);

export const SCOPE_DESCRIPTIONS: Record<AuvryntScope, string> = {
  "auvrynt:read": "Inspect files, search, and perform read-only project analysis",
  "auvrynt:write": "Edit and create files",
  "auvrynt:process": "Run local commands and processes with the current OS user's privileges",
  "auvrynt:web": "Use browser and web-development tools",
  "auvrynt:software": "Use software and .NET tools",
  "auvrynt:godot": "Use Godot project and editor tools",
  "auvrynt:blender": "Use workspace-bound Blender 3D tools",
  "auvrynt:blender-python": "Execute arbitrary Python inside Blender (host-level capability)",
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
  integrations: Required<AuvryntIntegrationsConfig>;
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

function normalizeAllowedHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) throw new Error("Allowed Host entries must not be empty.");
  if (trimmed === "*") return trimmed;
  if (/[\/@?#]/.test(trimmed)) {
    throw new Error(`Invalid allowed Host entry: ${host}. Use a hostname or IP address without scheme, path, query, or fragment.`);
  }

  const unbracketed = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const ipVersion = isIP(unbracketed);
  if (ipVersion === 6) return `[${unbracketed}]`;
  if (ipVersion === 4) return unbracketed;
  if (trimmed.includes(":")) {
    throw new Error(`Invalid allowed Host entry: ${host}. Ports are not part of the Host allowlist.`);
  }
  if (!/^[a-z0-9.-]+$/.test(trimmed) || trimmed.startsWith(".") || trimmed.endsWith(".")) {
    throw new Error(`Invalid allowed Host entry: ${host}`);
  }
  return trimmed;
}

function normalizeAllowedHosts(rawHosts: string[], derivedHosts: string[]): string[] {
  const hosts = rawHosts.length > 0 ? rawHosts : derivedHosts;
  if (hosts.some((host) => host.trim() === "*")) return ["*"];
  return Array.from(new Set(hosts.map(normalizeAllowedHost)));
}

function parseBoolean(value: string | boolean | undefined, name = "boolean value"): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid ${name}: ${value}`);
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

function parsePositiveInteger(value: string | number | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;

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

function parseOAuthScopes(value: string | undefined): AuvryntScope[] {
  const requested = parseStringList(value, DEFAULT_OAUTH_SCOPES);
  const supported = new Set<string>(SUPPORTED_SCOPES);
  const invalid = requested.filter((scope) => !supported.has(scope));
  if (invalid.length > 0) {
    throw new Error(`Invalid AUVRYNT_OAUTH_SCOPES: unsupported scope(s): ${invalid.join(", ")}`);
  }
  return Array.from(new Set(requested)) as AuvryntScope[];
}

export function oauthScopesForIntegrations(integrations: AuvryntIntegrationsConfig): AuvryntScope[] {
  const scopes: AuvryntScope[] = ["auvrynt:read", "auvrynt:write"];
  if (integrations.playwright) scopes.push("auvrynt:web", "auvrynt:process");
  if (integrations.godotGdscript || integrations.godotCsharp) scopes.push("auvrynt:godot");
  if (integrations.godotCsharp) scopes.push("auvrynt:software", "auvrynt:process");
  if (integrations.blender) scopes.push("auvrynt:blender");
  if (integrations.serena) scopes.push("auvrynt:serena");
  return Array.from(new Set(scopes));
}

function parseOAuthConfig(
  env: NodeJS.ProcessEnv,
  ownerToken: string | undefined,
  integrations: AuvryntIntegrationsConfig,
): OAuthConfig {
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
    scopes: parseOAuthScopes(env.AUVRYNT_OAUTH_SCOPES)
      .filter((scope) => oauthScopesForIntegrations(integrations).includes(scope)
        || (scope === "auvrynt:blender-python" && integrations.blender)),
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
  const filesSerena = filesConfig.serena ?? {};
  const backend = env.AUVRYNT_SERENA_BACKEND ?? filesSerena.backend ?? "LSP";
  if (backend !== "LSP" && backend !== "JetBrains") {
    throw new Error(`Invalid AUVRYNT_SERENA_BACKEND: ${backend}`);
  }
  return {
    enabled: parseBoolean(env.AUVRYNT_SERENA_ENABLED ?? filesSerena.enabled, "AUVRYNT_SERENA_ENABLED"),
    executable: env.AUVRYNT_SERENA_EXECUTABLE ?? env.AUVRYNT_SERENA_PATH ?? filesConfig.executables?.serena ?? filesSerena.executable ?? "serena",
    backend,
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

function parseOptionalIntegrationBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean" || typeof value === "string") return parseBoolean(value, name);
  throw new Error(`Invalid ${name}: expected boolean`);
}

function parseIntegrationsConfig(env: NodeJS.ProcessEnv, filesConfig: AuvryntUserConfig): Required<AuvryntIntegrationsConfig> {
  const configIntegrations = filesConfig.integrations ?? {};
  return {
    godotGdscript: parseOptionalIntegrationBoolean(env.AUVRYNT_GODOT_GDSCRIPT_ENABLED, "AUVRYNT_GODOT_GDSCRIPT_ENABLED") ?? configIntegrations.godotGdscript ?? true,
    godotCsharp: parseOptionalIntegrationBoolean(env.AUVRYNT_GODOT_CSHARP_ENABLED, "AUVRYNT_GODOT_CSHARP_ENABLED") ?? configIntegrations.godotCsharp ?? true,
    blender: parseOptionalIntegrationBoolean(env.AUVRYNT_BLENDER_ENABLED, "AUVRYNT_BLENDER_ENABLED") ?? configIntegrations.blender ?? true,
    serena: parseOptionalIntegrationBoolean(
      env.AUVRYNT_SERENA_INTEGRATION_ENABLED ?? env.AUVRYNT_SERENA_ENABLED,
      "AUVRYNT_SERENA_INTEGRATION_ENABLED",
    ) ?? configIntegrations.serena ?? true,
    playwright: parseOptionalIntegrationBoolean(env.AUVRYNT_PLAYWRIGHT_ENABLED, "AUVRYNT_PLAYWRIGHT_ENABLED") ?? configIntegrations.playwright ?? true,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const files = loadAuvryntFiles(env);
  const integrations = parseIntegrationsConfig(env, files.config);
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
    oauth: parseOAuthConfig(env, files.auth.ownerToken, integrations),
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
    integrations,
  };
}

function parsePublicBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid AUVRYNT_PUBLIC_BASE_URL scheme: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("AUVRYNT_PUBLIC_BASE_URL must not contain embedded credentials.");
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("AUVRYNT_PUBLIC_BASE_URL must be an origin only (scheme, host, and optional port). Do not include a path, query, or fragment.");
  }
  return parsed.origin;
}

function localPublicBaseUrl(host: string, port: number): string {
  const publicHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const formattedHost = publicHost.includes(":") && !publicHost.startsWith("[")
    ? `[${publicHost}]`
    : publicHost;
  return `http://${formattedHost}:${port}`;
}
