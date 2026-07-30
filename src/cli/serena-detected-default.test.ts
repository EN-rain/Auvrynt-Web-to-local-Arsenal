import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import type { LocalIntegrationDiscovery } from "../integration-discovery.js";
import { applyDetectedSerenaDefault, hasExplicitSerenaEnablement } from "./serena-detected-default.js";

const configDir = await mkdtemp(join(tmpdir(), "auvrynt-serena-default-"));
try {
  const env = {
    AUVRYNT_CONFIG_DIR: configDir,
    AUVRYNT_ALLOWED_ROOTS: configDir,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  };
  const discovery: LocalIntegrationDiscovery = {
    processes: [],
    executables: { serena: "C:/tools/serena.exe" },
    ports: {},
  };

  const detectedConfig = loadConfig(env);
  detectedConfig.integrations.serena = false;
  detectedConfig.serena.enabled = false;
  assert.equal(applyDetectedSerenaDefault(detectedConfig, discovery, {}, env), true);
  assert.equal(detectedConfig.integrations.serena, true);
  assert.equal(detectedConfig.serena.enabled, true);
  assert.equal(detectedConfig.executables.serena, "C:/tools/serena.exe");
  assert.equal(detectedConfig.serena.executable, "C:/tools/serena.exe");

  const explicitlyDisabled = loadConfig(env);
  explicitlyDisabled.integrations.serena = false;
  explicitlyDisabled.serena.enabled = false;
  assert.equal(
    applyDetectedSerenaDefault(
      explicitlyDisabled,
      discovery,
      { integrations: { serena: false } },
      env,
    ),
    false,
  );
  assert.equal(explicitlyDisabled.integrations.serena, false);
  assert.equal(explicitlyDisabled.serena.enabled, false);

  assert.equal(hasExplicitSerenaEnablement({}, env), false);
  assert.equal(hasExplicitSerenaEnablement({ serena: { enabled: false } }, env), true);
  assert.equal(hasExplicitSerenaEnablement({}, { ...env, AUVRYNT_SERENA_ENABLED: "0" }), true);
} finally {
  await rm(configDir, { recursive: true, force: true });
}

console.log("Detected Serena default enablement tests passed!");
