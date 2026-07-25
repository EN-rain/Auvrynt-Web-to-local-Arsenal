import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export interface LocalIntegrationDiscovery {
  processes: string[];
  executables: Record<string, string | undefined>;
  ports: Record<string, boolean>;
}

const PROCESS_MARKERS: Record<string, string[]> = {
  blender: ["blender.exe", "blender"],
  godot: ["godot.exe", "godot4.exe", "godot"],
  cloudflare_tunnel: ["cloudflared.exe", "cloudflared"],
  serena: ["serena.exe", "serena"],
};

function probePort(host: string, port: number, timeoutMs = 350): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (available: boolean) => {
      socket.destroy();
      resolve(available);
    };

    const timeout = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timeout);
      finish(true);
    });
    socket.once("error", () => {
      clearTimeout(timeout);
      finish(false);
    });
  });
}

async function runningProcessNames(): Promise<string[]> {
  if (process.platform !== "win32") return [];

  try {
    const { stdout } = await execFileAsync("tasklist.exe", ["/FO", "CSV", "/NH"], { timeout: 5_000 });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^"([^"]+)"/)?.[1]?.toLowerCase())
      .filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

import { join } from "node:path";
import { homedir } from "node:os";

async function findExecutable(command: string): Promise<string | undefined> {
  const exes = process.platform === "win32" ? [`${command}.exe`, command] : [command];
  const userBinDirs = [
    join(homedir(), ".auvrynt", "bin"),
    join(homedir(), ".local", "bin"),
    join(homedir(), "AppData", "Roaming", "Python", "Scripts"),
  ];

  for (const dir of userBinDirs) {
    for (const exe of exes) {
      const fullPath = join(dir, exe);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  try {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(cmd, [command], { timeout: 5_000 });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}


function hasProcess(processes: string[], markers: string[]): boolean {
  return processes.some((processName) => markers.some((marker) => processName === marker || processName.includes(marker)));
}

export async function discoverLocalIntegrations(): Promise<LocalIntegrationDiscovery> {
  let configExecs: Record<string, string | undefined> = {};
  try {
    const config = loadConfig();
    configExecs = config.executables;
  } catch {}

  const blenderMcpPort = Number(process.env.AUVRYNT_BLENDER_MCP_PORT ?? 9876);
  const [processes, cloudflaredSys, serenaSys, godotSys, blenderSys, blenderLabMcp, auvryntBlenderBridge, auvryntGodotBridge, playwrightMcp] = await Promise.all([
    runningProcessNames(),
    findExecutable("cloudflared"),
    findExecutable("serena"),
    findExecutable("godot"),
    findExecutable("blender"),
    probePort("127.0.0.1", blenderMcpPort),
    probePort("127.0.0.1", 49323),
    probePort("127.0.0.1", 49322),
    probePort("127.0.0.1", Number(process.env.AUVRYNT_PLAYWRIGHT_PORT ?? 3000)),
  ]);

  const serena = configExecs.serena || serenaSys;
  const godot = configExecs.godot || godotSys;
  const godotCsharp = configExecs.godotCsharp;
  const blender = configExecs.blender || blenderSys;

  return {
    processes,
    executables: {
      cloudflared: cloudflaredSys,
      serena,
      godot,
      godotCsharp,
      blender,
    },
    ports: {
      blender_lab_mcp: blenderLabMcp,
      auvrynt_blender_bridge: auvryntBlenderBridge,
      auvrynt_godot_bridge: auvryntGodotBridge,
      playwright: playwrightMcp,
    },
  };
}

export function processDetected(discovery: LocalIntegrationDiscovery, integration: keyof typeof PROCESS_MARKERS): boolean {
  return hasProcess(discovery.processes, PROCESS_MARKERS[integration]);
}
