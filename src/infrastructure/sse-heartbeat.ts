import type { Response } from "express";

export const DEFAULT_SSE_HEARTBEAT_INTERVAL_MS = 15_000;

export interface SseHeartbeatHandle {
  stop(): void;
}

/**
 * Keeps long-running MCP SSE responses active through reverse proxies and
 * tunnels. SSE comment frames are ignored by clients but count as traffic, so
 * an otherwise silent build or render is less likely to be terminated as an
 * upstream 502/504 timeout.
 */
export function attachSseHeartbeat(
  response: Pick<
    Response,
    "headersSent" | "writableEnded" | "destroyed" | "getHeader" | "setHeader" | "write" | "once"
  >,
  intervalMs = DEFAULT_SSE_HEARTBEAT_INTERVAL_MS,
): SseHeartbeatHandle {
  if (!Number.isFinite(intervalMs) || intervalMs < 1) {
    throw new Error("SSE heartbeat interval must be a positive number.");
  }

  if (!response.headersSent) {
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("X-Accel-Buffering", "no");
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };

  const timer = setInterval(() => {
    if (response.writableEnded || response.destroyed) {
      stop();
      return;
    }
    if (!response.headersSent || !isEventStream(response.getHeader("content-type"))) return;

    try {
      response.write(`: auvrynt-heartbeat ${Date.now()}\n\n`);
    } catch {
      stop();
    }
  }, intervalMs);
  timer.unref();

  response.once("finish", stop);
  response.once("close", stop);

  return { stop };
}

function isEventStream(contentType: unknown): boolean {
  if (Array.isArray(contentType)) {
    return contentType.some((value) => String(value).toLowerCase().includes("text/event-stream"));
  }
  return String(contentType ?? "").toLowerCase().includes("text/event-stream");
}
