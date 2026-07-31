import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";

export function sendJsonRpcError(
  res: Response,
  status: number,
  code: number,
  message: string,
): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id: null,
  });
}

export function requestLogFields(req: Request): Record<string, unknown> {
  return {
    userAgent: req.header("user-agent"),
    contentLength: req.header("content-length"),
  };
}

export function mcpClientName(req: Request): string | undefined {
  const headerName = req.header("x-mcp-client-name") ?? req.header("x-client-name");
  if (headerName) return headerName;
  const body = req.body as { params?: { clientInfo?: { name?: unknown } } } | undefined;
  const name = body?.params?.clientInfo?.name;
  return typeof name === "string" ? name : undefined;
}

export async function isMainModule(moduleUrl: string): Promise<boolean> {
  if (!process.argv[1]) return false;
  const modulePath = await realpath(fileURLToPath(moduleUrl));
  const entrypointPath = await realpath(process.argv[1]);
  return modulePath === entrypointPath;
}
