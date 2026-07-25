import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

async function findExecutable(command: string): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const { stdout } = await execFileAsync("where.exe", [command], { timeout: 5_000 });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

function hasProcess(processes: string[], markers: string[]): boolean {
  return processes.some((processName) => markers.some((marker) => processName === marker || processName.includes(marker)));
}

export async function discoverLocalIntegrations(): Promise<LocalIntegrationDiscovery> {
  const blenderMcpPort = Number(process.env.AUVRYNT_BLENDER_MCP_PORT ?? 9876);
  const [processes, cloudflared, serena, blenderLabMcp, auvryntBlenderBridge, auvryntGodotBridge] = await Promise.all([
    runningProcessNames(),
    findExecutable("cloudflared"),
    findExecutable("serena"),
    probePort("127.0.0.1", blenderMcpPort),
    probePort("127.0.0.1", 49323),
    probePort("127.0.0.1", 49322),
  ]);

  return {
    processes,
    executables: { cloudflared, serena },
    ports: {
      blender_lab_mcp: blenderLabMcp,
      auvrynt_blender_bridge: auvryntBlenderBridge,
      auvrynt_godot_bridge: auvryntGodotBridge,
    },
  };
}

export function processDetected(discovery: LocalIntegrationDiscovery, integration: keyof typeof PROCESS_MARKERS): boolean {
  return hasProcess(discovery.processes, PROCESS_MARKERS[integration]);
}
