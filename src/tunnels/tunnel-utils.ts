import { execFileSync } from "node:child_process";
import type { TunnelProvider } from "../background-lifecycle.js";

const GENERATED_NGROK_HOST = /(^|\.)ngrok(?:-free)?\.(?:app|dev|io)$/i;

export function findCommand(command: string): string | undefined {
  try {
    return execFileSync(
      process.platform === "win32" ? "where.exe" : "which",
      [command],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    ).split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function tunnelProviderLabel(provider: TunnelProvider): string {
  return provider === "ngrok" ? "ngrok" : "Cloudflare";
}

export function normalizeNgrokUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (parsed.protocol !== "https:") throw new Error("ngrok URL must use HTTPS.");
  if (parsed.username || parsed.password) throw new Error("ngrok URL must not contain credentials.");
  if (parsed.port) throw new Error("ngrok URL must not contain a custom port.");
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("ngrok URL must be an origin without a path, query, or fragment.");
  }
  return parsed.origin;
}

export function isGeneratedNgrokUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      && !parsed.port && (parsed.pathname === "/" || parsed.pathname === "")
      && !parsed.search && !parsed.hash && GENERATED_NGROK_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function tunnelUrlMatchesProvider(
  url: string,
  provider: TunnelProvider,
  expectedNgrokUrl?: string,
): boolean {
  if (provider === "ngrok") {
    const expected = normalizeNgrokUrl(expectedNgrokUrl);
    if (expected) return url === expected;
    return isGeneratedNgrokUrl(url);
  }
  return /^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com$/.test(url);
}

export function tunnelExecutableNamePattern(provider: TunnelProvider): RegExp {
  return provider === "ngrok"
    ? /(^|[\\/])ngrok(?:\.exe)?$/i
    : /(^|[\\/])cloudflared(?:\.exe)?$/i;
}
