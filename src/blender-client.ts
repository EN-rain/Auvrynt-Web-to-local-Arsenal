import { createConnection, type Socket } from "node:net";

export interface BlenderClientConfig {
  host?: string; // Default: "127.0.0.1"
  port?: number; // Default: 9876
  timeoutMs?: number; // Default: 180000 (180s)
  longTaskTimeoutMs?: number; // Default: 7200000 (2h)
}

export class BlenderClient {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly longTaskTimeoutMs: number;
  private activeMutationPromise: Promise<any> = Promise.resolve();

  constructor(config: BlenderClientConfig = {}) {
    this.host = config.host || "127.0.0.1";
    this.port = config.port || 9876;
    this.timeoutMs = config.timeoutMs || 180000;
    this.longTaskTimeoutMs = config.longTaskTimeoutMs || 7200000;

    // Security check: enforce loopback host
    if (this.host !== "127.0.0.1" && this.host !== "localhost") {
      throw new Error(`Forbidden host: ${this.host}. Only loopback connection is allowed for Blender MCP.`);
    }
  }

  /**
   * Sends Python code to the Blender bridge over TCP socket.
   * Ensures single execution at a time to prevent concurrency issues.
   */
  async sendExecute(code: string, strictJson = true, isLongTask = false): Promise<any> {
    const action = () => this.sendExecuteInternal(code, strictJson, isLongTask);
    this.activeMutationPromise = this.activeMutationPromise.then(action, action);
    return this.activeMutationPromise;
  }

  private async sendExecuteInternal(code: string, strictJson: boolean, isLongTask: boolean): Promise<any> {
    const timeout = isLongTask ? this.longTaskTimeoutMs : this.timeoutMs;

    const request = {
      type: "execute",
      code,
      strict_json: strictJson,
    };
    const payload = Buffer.concat([Buffer.from(JSON.stringify(request), "utf8"), Buffer.from([0])]);

    // Limit payload size to 1 MB
    if (payload.length > 1024 * 1024) {
      throw new Error("Payload size limit exceeded (max 1 MB)");
    }

    return new Promise((resolve, reject) => {
      let client: Socket | null = null;
      let buffer = Buffer.alloc(0);
      let timeoutId: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (client) {
          client.destroy();
          client = null;
        }
      };

      try {
        client = createConnection({ host: this.host, port: this.port }, () => {
          client?.write(payload);
        });

        timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error(`Blender connection timed out after ${timeout}ms`));
        }, timeout);

        client.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)]);
          // Check for null terminator
          const nullIndex = buffer.indexOf(0);
          if (nullIndex !== -1) {
            const raw = buffer.subarray(0, nullIndex).toString("utf8").trim();
            cleanup();

            try {
              const parsed = JSON.parse(raw);
              if (parsed.status === "ok") {
                resolve(parsed.result || {});
              } else {
                reject(new Error(parsed.message || "Unknown Blender execution error"));
              }
            } catch (e: any) {
              reject(new Error(`Failed to parse Blender JSON response: ${e.message}`));
            }
          }
        });

        client.on("error", (err) => {
          cleanup();
          reject(new Error(`Blender connection error: ${err.message}`));
        });
      } catch (err: any) {
        cleanup();
        reject(err);
      }
    });
  }
}

// Global active client registry matching workspace Id
const activeBlenderClients = new Map<string, BlenderClient>();

export function getBlenderClient(workspaceId: string, config?: BlenderClientConfig): BlenderClient {
  let client = activeBlenderClients.get(workspaceId);
  if (!client) {
    client = new BlenderClient(config);
    activeBlenderClients.set(workspaceId, client);
  }
  return client;
}
