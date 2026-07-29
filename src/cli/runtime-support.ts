import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { planCrashRecovery } from "../crash-recovery.js";

export interface ConsoleRow {
  label: string;
  value: string;
}

export function writeFatalLog(stateDir: string, type: string, error: unknown): void {
  const value = error instanceof Error ? (error.stack ?? error.message) : String(error);
  try {
    appendFileSync(join(stateDir, "fatal-errors.log"), `[${new Date().toISOString()}] ${type}\n${value}\n\n`, "utf8");
  } catch {
    // Fatal logging must never prevent process termination.
  }
}

export function scheduleCrashRecovery(stateDir: string, reason: string): boolean {
  if (process.env.AUVRYNT_START_MODE !== "true" || !process.argv[1]) return false;
  const plan = planCrashRecovery(process.env);
  if (!plan.allowed) {
    writeFatalLog(stateDir, "crashRecoveryStopped", `Restart limit reached after ${plan.attempt - 1} attempts: ${reason}`);
    return false;
  }

  try {
    const helperPath = fileURLToPath(new URL("../../scripts/restart-after-crash.mjs", import.meta.url));
    const encodedArgs = Buffer.from(JSON.stringify(process.argv.slice(2)), "utf8").toString("base64url");
    const helper = spawn(process.execPath, [helperPath, String(process.pid), process.argv[1], encodedArgs], {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
      env: plan.environment,
    });
    helper.once("error", (error) => writeFatalLog(stateDir, "crashRecoverySpawnFailed", error));
    helper.unref();
    writeFatalLog(stateDir, "crashRecoveryScheduled", `Attempt ${plan.attempt}: ${reason}`);
    return true;
  } catch (error) {
    writeFatalLog(stateDir, "crashRecoverySpawnFailed", error);
    return false;
  }
}

export function httpUrl(host: string, port: number, path = ""): string {
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${formattedHost}:${port}${path}`;
}

export function localProbeHost(host: string): string {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

export function dashboardUrl(host: string, port: number): string {
  return httpUrl(localProbeHost(host), port, "/dashboard");
}

export const RUNNING_COMMAND_HINTS = [
  "# auvrynt token  — show the owner token for authentication",
  "# auvrynt stop   — stop Auvrynt and exit",
] as const;

export function printConsolePanel(
  title: string,
  rows: ConsoleRow[] = [],
  footer?: string | readonly string[],
): void {
  const labelWidth = rows.reduce((width, row) => Math.max(width, row.label.length), 0);
  console.log(`┌  ${title}`);
  for (const row of rows) console.log(`│  ${row.label.padEnd(labelWidth)}  ${row.value}`);

  const footerLines = footer === undefined
    ? []
    : typeof footer === "string"
      ? [footer]
      : [...footer];
  if (footerLines.length === 0) {
    console.log("└");
    return;
  }
  for (const line of footerLines.slice(0, -1)) console.log(`│  ${line}`);
  console.log(`└  ${footerLines.at(-1)}`);
}
