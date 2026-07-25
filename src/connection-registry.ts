import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ConnectedClient {
  provider: string;
  userAgent?: string;
  lastSeen: string;
  requestCount: number;
}

const REGISTRY_FILE = "connections.json";

export function connectionRegistryPath(stateDir: string): string {
  return join(stateDir, REGISTRY_FILE);
}

export function identifyProvider(clientName?: string, userAgent?: string): string {
  const value = `${clientName ?? ""} ${userAgent ?? ""}`.trim();
  const normalized = value.toLowerCase();
  const knownProviders: Array<[string, string]> = [
    ["chatgpt", "ChatGPT"],
    ["openai", "OpenAI"],
    ["claude", "Claude"],
    ["anthropic", "Claude / Anthropic"],
    ["kimi", "Kimi"],
    ["cursor", "Cursor"],
    ["windsurf", "Windsurf"],
    ["gemini", "Gemini"],
    ["vscode", "VS Code"],
    ["visual studio code", "VS Code"],
    ["codex", "Codex"],
  ];

  for (const [marker, provider] of knownProviders) {
    if (normalized.includes(marker)) return provider;
  }

  if (clientName?.trim()) return clientName.trim().slice(0, 80);
  if (userAgent?.trim()) return userAgent.trim().split(/[\s/]/, 1)[0].slice(0, 80) || "Unknown MCP client";
  return "Unknown MCP client";
}

function sanitizeUserAgent(userAgent?: string): string | undefined {
  if (!userAgent) return undefined;
  return userAgent.replace(/[\r\n]/g, " ").slice(0, 160);
}

export function readConnectedClients(stateDir: string): ConnectedClient[] {
  const path = connectionRegistryPath(stateDir);
  if (!existsSync(path)) return [];

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ConnectedClient => Boolean(entry && typeof entry === "object"));
  } catch {
    return [];
  }
}

export function recordConnectedClient(
  stateDir: string,
  input: { clientName?: string; userAgent?: string },
): void {
  mkdirSync(stateDir, { recursive: true });
  const provider = identifyProvider(input.clientName, input.userAgent);
  const clients = readConnectedClients(stateDir);
  const existing = clients.find((client) => client.provider === provider);
  const now = new Date().toISOString();

  if (existing) {
    existing.lastSeen = now;
    existing.requestCount += 1;
    existing.userAgent = sanitizeUserAgent(input.userAgent) ?? existing.userAgent;
  } else {
    clients.push({
      provider,
      userAgent: sanitizeUserAgent(input.userAgent),
      lastSeen: now,
      requestCount: 1,
    });
  }

  clients.sort((left, right) => right.lastSeen.localeCompare(left.lastSeen));
  writeFileSync(connectionRegistryPath(stateDir), JSON.stringify(clients.slice(0, 32), null, 2) + "\n", { mode: 0o600 });
}
