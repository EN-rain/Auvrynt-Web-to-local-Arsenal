import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";

const emptyConfigDir = mkdtempSync(join(tmpdir(), "auvrynt-empty-config-test-"));
const baseEnv = {
  AUVRYNT_CONFIG_DIR: emptyConfigDir,
  AUVRYNT_ALLOWED_ROOTS: process.cwd(),
  AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
};

assert.equal(loadConfig(baseEnv).widgets, "full");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "changes" }).widgets, "changes");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "full" }).widgets, "full");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "off" }).widgets, "off");
assert.equal(loadConfig(baseEnv).toolNaming, "short");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_TOOL_NAMING: "short" }).toolNaming, "short");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_TOOL_NAMING: "legacy" }).toolNaming, "legacy");
assert.equal(loadConfig(baseEnv).minimalTools, true);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_TOOL_MODE: "minimal" }).minimalTools, true);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_TOOL_MODE: "full" }).minimalTools, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_MINIMAL_TOOLS: "0" }).minimalTools, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_MINIMAL_TOOLS: "1" }).minimalTools, true);
assert.equal(loadConfig(baseEnv).skillsEnabled, true);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_SKILLS: "0" }).skillsEnabled, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_SKILLS: "1" }).skillsEnabled, true);

assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "invalid" }),
  /Invalid AUVRYNT_WIDGETS: invalid/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "minimal" }),
  /Invalid AUVRYNT_WIDGETS: minimal/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_WIDGETS: "write-only" }),
  /Invalid AUVRYNT_WIDGETS: write-only/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_TOOL_MODE: "invalid" }),
  /Invalid AUVRYNT_TOOL_MODE: invalid/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_TOOL_NAMING: "invalid" }),
  /Invalid AUVRYNT_TOOL_NAMING: invalid/,
);

assert.deepEqual(loadConfig(baseEnv).logging, {
  level: "info",
  format: "json",
  requests: true,
  assets: false,
  toolCalls: true,
  shellCommands: false,
  trustProxy: false,
});

assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "silent" }).logging.level, "silent");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "error" }).logging.level, "error");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "warn" }).logging.level, "warn");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "info" }).logging.level, "info");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "debug" }).logging.level, "debug");

assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_FORMAT: "json" }).logging.format, "json");
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_FORMAT: "pretty" }).logging.format, "pretty");

assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_REQUESTS: "0" }).logging.requests, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_ASSETS: "1" }).logging.assets, true);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_TOOL_CALLS: "0" }).logging.toolCalls, false);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_LOG_SHELL_COMMANDS: "1" }).logging.shellCommands, true);
assert.equal(loadConfig({ ...baseEnv, AUVRYNT_TRUST_PROXY: "1" }).logging.trustProxy, true);

assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_LOG_LEVEL: "trace" }),
  /Invalid AUVRYNT_LOG_LEVEL: trace/,
);

assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_LOG_FORMAT: "color" }),
  /Invalid AUVRYNT_LOG_FORMAT: color/,
);

assert.equal(loadConfig(baseEnv).oauth.ownerToken, "test-owner-token-that-is-long-enough");
assert.deepEqual(loadConfig(baseEnv).oauth.scopes, [
  "auvrynt:read",
  "auvrynt:write",
  "auvrynt:process",
  "auvrynt:web",
  "auvrynt:software",
  "auvrynt:godot",
  "auvrynt:blender",
  "auvrynt:serena",
]);
assert.deepEqual(loadConfig(baseEnv).oauth.allowedRedirectHosts, [
  "chatgpt.com",
  "claude.ai",
  "claude.com",
  "localhost",
  "127.0.0.1",
]);
assert.equal(loadConfig(baseEnv).oauth.accessTokenTtlSeconds, 3600);
assert.equal(loadConfig(baseEnv).oauth.refreshTokenTtlSeconds, 2592000);

assert.deepEqual(
  loadConfig({ ...baseEnv, AUVRYNT_OAUTH_SCOPES: "auvrynt:read,admin" }).oauth.scopes,
  ["auvrynt:read", "admin"],
);
assert.deepEqual(
  loadConfig({ ...baseEnv, AUVRYNT_OAUTH_ALLOWED_REDIRECT_HOSTS: "chatgpt.com,example.com" }).oauth
    .allowedRedirectHosts,
  ["chatgpt.com", "example.com"],
);
assert.equal(
  loadConfig({ ...baseEnv, AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS: "120" }).oauth
    .accessTokenTtlSeconds,
  120,
);
assert.equal(
  loadConfig({ ...baseEnv, AUVRYNT_OAUTH_REFRESH_TOKEN_TTL_SECONDS: "240" }).oauth
    .refreshTokenTtlSeconds,
  240,
);

assert.throws(
  () => loadConfig({ AUVRYNT_CONFIG_DIR: emptyConfigDir, AUVRYNT_ALLOWED_ROOTS: process.cwd() }),
  /AUVRYNT_OAUTH_OWNER_TOKEN is required/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_OAUTH_OWNER_TOKEN: "too-short" }),
  /AUVRYNT_OAUTH_OWNER_TOKEN must be at least 16 characters long/,
);
assert.throws(
  () => loadConfig({ ...baseEnv, AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS: "0" }),
  /Invalid AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS: 0/,
);

assert.equal(loadConfig(baseEnv).publicBaseUrl, "http://127.0.0.1:49321");
assert.deepEqual(loadConfig(baseEnv).allowedHosts, ["localhost", "127.0.0.1", "::1"]);

assert.equal(
  loadConfig({ ...baseEnv, AUVRYNT_PUBLIC_BASE_URL: "https://abc.trycloudflare.com/" }).publicBaseUrl,
  "https://abc.trycloudflare.com",
);
assert.deepEqual(
  loadConfig({ ...baseEnv, AUVRYNT_PUBLIC_BASE_URL: "https://abc.trycloudflare.com/" }).allowedHosts,
  ["localhost", "127.0.0.1", "::1", "abc.trycloudflare.com"],
);
assert.deepEqual(
  loadConfig({ ...baseEnv, AUVRYNT_ALLOWED_HOSTS: "*" }).allowedHosts,
  ["*"],
);

const configDir = mkdtempSync(join(tmpdir(), "auvrynt-config-test-"));
writeFileSync(
  join(configDir, "config.json"),
  JSON.stringify({
    port: 8787,
    allowedRoots: [process.cwd()],
    publicBaseUrl: "https://auvrynt.example.com",
  }),
);
writeFileSync(
  join(configDir, "auth.json"),
  JSON.stringify({
    ownerToken: "persisted-owner-token-long-enough",
  }),
);

const fileConfig = loadConfig({ AUVRYNT_CONFIG_DIR: configDir });
assert.equal(fileConfig.port, 8787);
assert.equal(fileConfig.oauth.ownerToken, "persisted-owner-token-long-enough");
assert.equal(fileConfig.publicBaseUrl, "https://auvrynt.example.com");
assert.deepEqual(fileConfig.allowedHosts, [
  "localhost",
  "127.0.0.1",
  "::1",
  "auvrynt.example.com",
]);
