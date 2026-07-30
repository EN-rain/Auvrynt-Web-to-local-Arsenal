import type { ServerConfig } from "../config.js";
import { processDetected, type LocalIntegrationDiscovery } from "../integration-discovery.js";
import type { AuvryntUserConfig } from "../user-config.js";

export function applyDetectedSerenaDefault(
  config: ServerConfig,
  discovery: LocalIntegrationDiscovery,
  userConfig: AuvryntUserConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const executable = discovery.executables.serena;
  if (executable) {
    config.executables.serena = executable;
    if (!hasExplicitSerenaExecutable(userConfig, env)) config.serena.executable = executable;
  }

  const detected = Boolean(executable || processDetected(discovery, "serena"));
  if (!detected || hasExplicitSerenaEnablement(userConfig, env)) return false;

  config.integrations.serena = true;
  config.serena.enabled = true;
  return true;
}

export function hasExplicitSerenaEnablement(
  userConfig: AuvryntUserConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.AUVRYNT_SERENA_INTEGRATION_ENABLED !== undefined
    || env.AUVRYNT_SERENA_ENABLED !== undefined
    || userConfig.integrations?.serena !== undefined
    || userConfig.serena?.enabled !== undefined;
}

function hasExplicitSerenaExecutable(
  userConfig: AuvryntUserConfig,
  env: NodeJS.ProcessEnv,
): boolean {
  return env.AUVRYNT_SERENA_EXECUTABLE !== undefined
    || env.AUVRYNT_SERENA_PATH !== undefined
    || userConfig.executables?.serena !== undefined
    || userConfig.serena?.executable !== undefined;
}
