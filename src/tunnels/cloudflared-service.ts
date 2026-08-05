import { execFileSync } from "node:child_process";

const SERVICE_NAME = "cloudflared";
const POLL_INTERVAL_MS = 250;
const START_TIMEOUT_MS = 30_000;

function queryService(): string {
  return execFileSync("sc.exe", ["query", SERVICE_NAME], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function serviceState(): "RUNNING" | "STOPPED" | "MISSING" | "OTHER" {
  if (process.platform !== "win32") return "MISSING";
  try {
    const output = queryService();
    if (/STATE\s+:\s+\d+\s+RUNNING/i.test(output)) return "RUNNING";
    if (/STATE\s+:\s+\d+\s+STOPPED/i.test(output)) return "STOPPED";
    return "OTHER";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/1060|does not exist|not found/i.test(message)) return "MISSING";
    throw new Error(`Could not query Windows service ${SERVICE_NAME}: ${message}`);
  }
}

async function waitForState(expected: "RUNNING" | "STOPPED"): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = serviceState();
    if (current === expected) return;
    if (current === "MISSING") throw new Error(`Windows service ${SERVICE_NAME} is not installed.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Windows service ${SERVICE_NAME} did not become ${expected.toLowerCase()} within 30 seconds.`);
}

export async function startCloudflaredService(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const current = serviceState();
  if (current === "RUNNING") return false;
  if (current === "MISSING") throw new Error("Windows service cloudflared is not installed. Install the Named Tunnel service from Cloudflare first.");

  try {
    execFileSync("sc.exe", ["start", SERVICE_NAME], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/1056|already running/i.test(message)) throw new Error(`Could not start Windows service ${SERVICE_NAME}: ${message}`);
  }
  await waitForState("RUNNING");
  return true;
}

export async function stopCloudflaredService(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const current = serviceState();
  if (current === "MISSING" || current === "STOPPED") return false;

  try {
    execFileSync("sc.exe", ["stop", SERVICE_NAME], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/1062|not been started|already stopped/i.test(message)) throw new Error(`Could not stop Windows service ${SERVICE_NAME}: ${message}`);
  }
  await waitForState("STOPPED");
  return true;
}
