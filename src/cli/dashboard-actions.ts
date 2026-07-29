import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Request } from "express";
import {
  INTEGRATION_KEYS,
  atomicWriteJson,
  readJsonFile,
  type InstanceLockRecord,
  type IntegrationKey,
} from "../background-lifecycle.js";
import type { ServerConfig } from "../config.js";
import { isLoopbackRequest, logEvent } from "../logger.js";
import type { RunningServer } from "../server.js";
import { selfHealStartIntegrations } from "./integration-bootstrap.js";
import { applyIntegrationProfile } from "./lifecycle-manager.js";
import { httpUrl } from "./runtime-support.js";

export interface DashboardActionDependencies {
  runningServer: RunningServer;
  config: ServerConfig;
  requestShutdown(): void;
}

export function registerDashboardActions({
  runningServer,
  config,
  requestShutdown,
}: DashboardActionDependencies): void {
  const { app } = runningServer;
  const dashboardOrigins = new Set([
    httpUrl("127.0.0.1", config.port),
    httpUrl("localhost", config.port),
    httpUrl(config.host, config.port),
  ]);
  let lastDashboardActionAt = 0;
  let dashboardRestartQueued = false;

  const actionAuthorized = (req: Request): boolean => {
    if (!isLoopbackRequest(req) || req.header("x-auvrynt-dashboard") !== "1") return false;
    const origin = req.header("origin");
    return !origin || dashboardOrigins.has(origin);
  };
  const actionRateLimited = (): boolean => {
    const now = Date.now();
    if (now - lastDashboardActionAt < 500) return true;
    lastDashboardActionAt = now;
    return false;
  };
  const persistActiveProfiles = async (profiles: IntegrationKey[]): Promise<void> => {
    const lockPath = join(config.stateDir, "server.lock");
    const record = await readJsonFile<InstanceLockRecord>(lockPath);
    if (!record || record.pid !== process.pid) return;
    record.profiles = profiles;
    await atomicWriteJson(lockPath, record);
  };
  const rejectUnauthorized = (req: Request, res: Parameters<Parameters<typeof app.post>[1]>[1]): boolean => {
    if (actionAuthorized(req)) return false;
    res.status(404).end();
    return true;
  };
  const rejectRateLimited = (res: Parameters<Parameters<typeof app.post>[1]>[1]): boolean => {
    if (!actionRateLimited()) return false;
    res.status(429).json({ error: "Dashboard actions are being submitted too quickly." });
    return true;
  };

  app.post("/__auvrynt/dashboard/integrations", async (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    const body = req.body as { integration?: unknown; enabled?: unknown };
    if (
      typeof body.integration !== "string"
      || !INTEGRATION_KEYS.includes(body.integration as IntegrationKey)
      || typeof body.enabled !== "boolean"
    ) {
      res.status(400).json({ error: "Invalid integration update." });
      return;
    }

    const key = body.integration as IntegrationKey;
    const integrations = { ...config.integrations, [key]: body.enabled };
    try {
      const healed = body.enabled
        ? await selfHealStartIntegrations(process.cwd(), config.executables, integrations)
        : {};
      const result = await runningServer.updateIntegrations(integrations, healed);
      if (!result.updated) {
        res.status(409).json({
          error: "An MCP tool call is active; retry after it finishes.",
          ...result,
        });
        return;
      }

      const profiles = INTEGRATION_KEYS.filter((profile) => integrations[profile]);
      applyIntegrationProfile(profiles);
      await persistActiveProfiles(profiles);
      logEvent(config.logging, "info", "dashboard_integration_updated", {
        integration: key,
        enabled: body.enabled,
      });
      res.json({
        ...result,
        integrations,
        message: `${key} ${body.enabled ? "enabled" : "disabled"}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEvent(config.logging, "error", "dashboard_integration_update_failed", {
        integration: key,
        error: message,
      });
      res.status(500).json({ error: message });
    }
  });

  app.post("/__auvrynt/dashboard/restart", (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    if (dashboardRestartQueued || !process.argv[1]) {
      res.status(409).json({
        error: dashboardRestartQueued
          ? "Restart is already queued."
          : "Restart entrypoint is unavailable.",
      });
      return;
    }

    dashboardRestartQueued = true;
    logEvent(config.logging, "warn", "dashboard_restart_requested");
    res.status(202).json({
      message: "Restart requested. The dashboard will reconnect shortly.",
    });
    setTimeout(() => {
      const environment = { ...process.env };
      delete environment.AUVRYNT_START_MODE;
      delete environment.AUVRYNT_CONTROL_TOKEN;
      delete environment.AUVRYNT_MANAGED_TUNNEL_URL;
      const child = spawn(process.execPath, [process.argv[1]!, "restart"], {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: environment,
      });
      child.once("error", (error) => {
        dashboardRestartQueued = false;
        logEvent(config.logging, "error", "dashboard_restart_spawn_failed", {
          error: error.message,
        });
      });
      child.unref();
    }, 150).unref();
  });

  app.post("/__auvrynt/dashboard/stop", (req, res) => {
    if (rejectUnauthorized(req, res) || rejectRateLimited(res)) return;
    logEvent(config.logging, "warn", "dashboard_stop_requested");
    res.status(202).json({ message: "Auvrynt is stopping." });
    setImmediate(requestShutdown);
  });
}
