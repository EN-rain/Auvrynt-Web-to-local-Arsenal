import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHomePath } from "./roots.js";

export interface AuvryntExecutablesConfig {
  serena?: string;
  godot?: string;
  godotCsharp?: string;
  blender?: string;
  [key: string]: string | undefined;
}

export interface AuvryntUserConfig {
  host?: string;
  port?: number;
  allowedRoots?: string[];
  publicBaseUrl?: string | null;
  allowedHosts?: string[];
  stateDir?: string;
  worktreeRoot?: string;
  agentDir?: string;
  executables?: AuvryntExecutablesConfig;
}

export interface AuvryntAuthConfig {
  ownerToken?: string;
}

export interface AuvryntFiles {
  dir: string;
  configPath: string;
  authPath: string;
  configExists: boolean;
  authExists: boolean;
  config: AuvryntUserConfig;
  auth: AuvryntAuthConfig;
}

export function auvryntConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(expandHomePath(env.AUVRYNT_CONFIG_DIR ?? join(homedir(), ".auvrynt")));
}

export function auvryntConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(auvryntConfigDir(env), "config.json");
}

export function auvryntAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(auvryntConfigDir(env), "auth.json");
}

export function loadAuvryntFiles(env: NodeJS.ProcessEnv = process.env): AuvryntFiles {
  const dir = auvryntConfigDir(env);
  const configPath = join(dir, "config.json");
  const authPath = join(dir, "auth.json");
  const configExists = existsSync(configPath);
  const authExists = existsSync(authPath);

  return {
    dir,
    configPath,
    authPath,
    configExists,
    authExists,
    config: configExists ? readJsonFile<AuvryntUserConfig>(configPath) : {},
    auth: authExists ? readJsonFile<AuvryntAuthConfig>(authPath) : {},
  };
}

export function writeAuvryntConfig(
  config: AuvryntUserConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const filePath = auvryntConfigPath(env);
  mkdirSync(auvryntConfigDir(env), { recursive: true });
  writeJsonFile(filePath, config, 0o600);
  return filePath;
}

export function writeAuvryntAuth(
  auth: AuvryntAuthConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const filePath = auvryntAuthPath(env);
  mkdirSync(auvryntConfigDir(env), { recursive: true });
  writeJsonFile(filePath, auth, 0o600);
  return filePath;
}

export function generateOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

function readJsonFile<T>(filePath: string): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${filePath}: ${reason}`);
  }
}

function writeJsonFile(filePath: string, value: unknown, mode: number): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", { mode });
}
