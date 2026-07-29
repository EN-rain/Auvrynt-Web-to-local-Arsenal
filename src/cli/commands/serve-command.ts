import type { ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { loadConfig } from "../../config.js";
import { parseStartRequest } from "../../background-lifecycle.js";
import { startTunnel } from "../../tunnels/tunnel-manager.js";
import {
  applyIntegrationProfile,
  type LifecycleManager,
} from "../lifecycle-manager.js";
import { selfHealStartIntegrations } from "../integration-bootstrap.js";
import { acquireInstanceLock } from "../instance-lock.js";
import { serveForegroundServer } from "../foreground-server.js";
import { ensureConfigured } from "./init-command.js";
import { ensureIntegrationChoicesConfigured } from "./integration-commands.js";

export async function runServeCommand(
  rawCommand: string | undefined,
  args: string[],
  lifecycle: LifecycleManager,
): Promise<void> {
  const startRequest = rawCommand === "start" ? parseStartRequest(args) : undefined;
  if (startRequest && !startRequest.backgroundChild) {
    const launchRoot = setDirectoryScopedRoot();
    await ensureConfigured({ directoryScoped: true });
    if (!startRequest.profiles) await ensureIntegrationChoicesConfigured();
    await lifecycle.start(startRequest, launchRoot);
    return;
  }

  if (rawCommand === "start") setDirectoryScopedRoot();
  await ensureConfigured({ directoryScoped: rawCommand === "start" });
  if (rawCommand === "start" && !startRequest?.profiles) {
    await ensureIntegrationChoicesConfigured();
  }
  if (startRequest?.profiles) applyIntegrationProfile(startRequest.profiles);

  const localConfig = loadConfig();
  exposeConfiguredGodotExecutables(localConfig.executables);
  const instanceLock = await acquireInstanceLock(
    localConfig.stateDir,
    localConfig.host,
    localConfig.port,
    startRequest?.profiles,
    resolve(process.cwd()),
  );
  let tunnel: { process: ChildProcess; url: string } | undefined;
  let stopTunnel: (() => void) | undefined;
  try {
    if (rawCommand === "start") {
      process.env.AUVRYNT_START_MODE = "true";
      const launchRoot = resolve(process.cwd());
      if (!startRequest?.backgroundChild) {
        await selfHealStartIntegrations(
          launchRoot,
          localConfig.executables,
          localConfig.integrations,
        );
      }
      const managedTunnelUrl = process.env.AUVRYNT_MANAGED_TUNNEL_URL;
      if (managedTunnelUrl) {
        process.env.AUVRYNT_PUBLIC_BASE_URL = managedTunnelUrl;
      } else {
        tunnel = await startTunnel(localConfig.tunnelProvider, localConfig.port, {
          ngrokAuthtoken: localConfig.ngrokAuthtoken,
          ngrokUrl: localConfig.ngrokUrl,
        });
        process.env.AUVRYNT_PUBLIC_BASE_URL = tunnel.url;
        stopTunnel = () => {
          if (tunnel && !tunnel.process.killed) tunnel.process.kill();
        };
        process.once("SIGINT", stopTunnel);
        process.once("SIGTERM", stopTunnel);
      }
    }
    await serveForegroundServer();
  } finally {
    if (stopTunnel) {
      process.removeListener("SIGINT", stopTunnel);
      process.removeListener("SIGTERM", stopTunnel);
      stopTunnel();
    }
    await instanceLock.release();
  }
}

function setDirectoryScopedRoot(): string {
  const launchRoot = resolve(process.cwd());
  process.env.AUVRYNT_ALLOWED_ROOTS = launchRoot;
  process.env.AUVRYNT_WORKTREE_ROOT = launchRoot;
  return launchRoot;
}

function exposeConfiguredGodotExecutables(
  executables: ReturnType<typeof loadConfig>["executables"],
): void {
  if (
    executables.godotCsharp
    && !process.env.GODOT_DOTNET_EXECUTABLE
  ) {
    process.env.GODOT_DOTNET_EXECUTABLE = executables.godotCsharp;
  }
  if (executables.godot && !process.env.GODOT_EXECUTABLE) {
    process.env.GODOT_EXECUTABLE = executables.godot;
  }
}
