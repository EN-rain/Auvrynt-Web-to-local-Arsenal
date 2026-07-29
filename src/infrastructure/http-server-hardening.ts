import type { Server as HttpServer } from "node:http";
import type { Socket } from "node:net";

export const HTTP_REQUEST_TIMEOUT_MS = 5 * 60_000;
export const HTTP_HEADERS_TIMEOUT_MS = 30_000;
export const HTTP_KEEP_ALIVE_TIMEOUT_MS = 75_000;
export const HTTP_SOCKET_KEEP_ALIVE_DELAY_MS = 30_000;
export const HTTP_MAX_HEADERS_COUNT = 100;
export const HTTP_MAX_REQUESTS_PER_SOCKET = 10_000;

/**
 * MCP responses may stream for a long time, but receiving request headers and
 * bodies must still have finite bounds to resist slow-client DoS.
 */
export function hardenHttpServer(httpServer: HttpServer): void {
  httpServer.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  httpServer.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
  httpServer.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  httpServer.timeout = 0;
  httpServer.maxHeadersCount = HTTP_MAX_HEADERS_COUNT;
  httpServer.maxRequestsPerSocket = HTTP_MAX_REQUESTS_PER_SOCKET;
  httpServer.on("connection", configureHttpSocket);
}

export function configureHttpSocket(
  socket: Pick<Socket, "setKeepAlive" | "setNoDelay">,
): void {
  socket.setKeepAlive(true, HTTP_SOCKET_KEEP_ALIVE_DELAY_MS);
  socket.setNoDelay(true);
}
