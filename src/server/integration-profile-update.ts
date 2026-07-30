import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  oauthScopesForIntegrations,
  type ServerConfig,
} from "../config.js";
import { logEvent } from "../logger.js";
import type { SerenaManager } from "../serena-manager.js";
import { syncMcpToolAvailability } from "./mcp-tool-registrar.js";

interface OAuthScopeGranter {
  grantScopesToExistingTokens(scopes: string[]): void;
}

export async function applyIntegrationProfileUpdate(input: {
  config: ServerConfig;
  integrations: ServerConfig["integrations"];
  serenaExecutable?: string;
  oauthProvider: OAuthScopeGranter;
  serenaManager: SerenaManager;
  mcpServers: Iterable<McpServer>;
}): Promise<void> {
  const {
    config,
    integrations,
    serenaExecutable,
    oauthProvider,
    serenaManager,
    mcpServers,
  } = input;

  Object.assign(config.integrations, integrations);
  const locallyApprovedScopes = oauthScopesForIntegrations(config.integrations);
  if (
    config.oauth.scopes.includes("auvrynt:blender-python")
    && config.integrations.blender
  ) {
    locallyApprovedScopes.push("auvrynt:blender-python");
  }
  oauthProvider.grantScopesToExistingTokens(locallyApprovedScopes);

  if (serenaExecutable) config.serena.executable = serenaExecutable;
  config.serena.enabled = integrations.serena;
  serenaManager.updateConfig({
    ...serenaManager.getConfig(),
    enabled: integrations.serena,
    executable: serenaExecutable ?? config.serena.executable,
  });
  if (!integrations.serena) await serenaManager.stopAllSessions();

  let enabledTools = 0;
  let disabledTools = 0;
  for (const server of mcpServers) {
    const result = syncMcpToolAvailability(server, config);
    enabledTools += result.enabled;
    disabledTools += result.disabled;
  }
  if (enabledTools > 0 || disabledTools > 0) {
    logEvent(config.logging, "info", "mcp_tool_availability_updated", {
      enabledTools,
      disabledTools,
      serenaEnabled: integrations.serena,
    });
  }
}
