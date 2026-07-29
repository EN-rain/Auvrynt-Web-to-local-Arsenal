import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ServerConfig } from "../../config.js";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";
import { getConnectionStatus } from "../../connection-status.js";
import { globFiles, inspectProject, searchText } from "../../search-discovery.js";
import { getRequestContext } from "../../request-context.js";
import { registerAppTool } from "../mcp-tool-registrar.js";
import {
  PROCESS_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  WORKSPACE_ID_SCHEMA,
  toolWidgetDescriptorMeta,
} from "../tool-registration-shared.js";

function errorResult(prefix: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `${prefix}: ${message}` }], isError: true as const };
}

export function registerProcessProjectTools(
  server: McpServer,
  config: ServerConfig,
  workspaces: WorkspaceRegistry,
  processManager: ProcessManager,
  logToolCall: (config: ServerConfig, fields: {
    tool: string;
    workspaceId?: string;
    path?: string;
    command?: string;
    success: boolean;
    durationMs: number;
    error?: string;
  }) => void,
): void {
  registerAppTool(server, "get_connection_status", {
    title: "Connection status",
    description: "Automatically check which local integrations are connected for this workspace: MCP, Blender, Godot, browser support, Chrome MCP availability, and tracked processes.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "read"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }, extra) => {
    try {
      const result = await getConnectionStatus(workspaces, processManager, config, extra.authInfo?.scopes ?? [], workspaceId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return errorResult("get_connection_status failed", error);
    }
  });

  registerAppTool(server, "start_process", {
    title: "Start process",
    description: "Start a persistent background process (server, app, game) inside an open workspace. Returns a processId. Use get_process_logs to tail output. Do not use run_shell for long-running processes.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      command: z.string().describe("Shell command to run."),
      workingDirectory: z.string().optional().describe("Working directory relative to workspace root."),
      environment: z.record(z.string(), z.string()).optional().describe("Additional environment variables (secrets will be redacted in responses)."),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, command, workingDirectory, environment }) => {
    const startedAt = performance.now();
    const ctx = getRequestContext();
    try {
      const result = processManager.startProcess({ workspaceId, ownerClientId: ctx?.ownerClientId, command, workingDirectory, environment });
      logToolCall(config, { tool: "start_process", workspaceId, command, success: true, durationMs: Math.round(performance.now() - startedAt) });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logToolCall(config, { tool: "start_process", workspaceId, command, success: false, durationMs: Math.round(performance.now() - startedAt), error: message });
      return errorResult("start_process failed", error);
    }
  });

  registerAppTool(server, "get_process_logs", {
    title: "Get process logs",
    description: "Retrieve recent stdout/stderr from a running or exited process started by start_process.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      processId: z.string().describe("Process ID returned by start_process."),
      lines: z.number().int().optional().describe("Number of recent lines to return (default 100, max 500)."),
      stream: z.enum(["stdout", "stderr", "both"]).optional().describe("Which stream to return."),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, processId, lines, stream }) => {
    try {
      const result = processManager.getProcessLogs({ workspaceId, processId, lines, stream, ownerClientId: getRequestContext()?.ownerClientId });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return errorResult("get_process_logs failed", error);
    }
  });

  registerAppTool(server, "list_processes", {
    title: "List processes",
    description: "List all tracked processes for the current workspace.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId }) => {
    try {
      const result = processManager.listProcesses({ workspaceId, ownerClientId: getRequestContext()?.ownerClientId });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return errorResult("list_processes failed", error);
    }
  });

  registerAppTool(server, "stop_process", {
    title: "Stop process",
    description: "Stop a tracked process gracefully. Set force=true to kill the process tree immediately.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      processId: z.string().describe("Process ID returned by start_process."),
      force: z.boolean().optional().describe("If true, forcibly kill the process tree."),
    },
    ...toolWidgetDescriptorMeta(config, "shell"), annotations: PROCESS_ANNOTATIONS,
  }, async ({ workspaceId, processId, force }) => {
    try {
      const result = await processManager.stopProcess({ workspaceId, processId, force, ownerClientId: getRequestContext()?.ownerClientId });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return errorResult("stop_process failed", error);
    }
  });

  registerAppTool(server, "glob_files", {
    title: "Glob files",
    description: "Find files by glob pattern within the workspace. Respects common ignore directories. Returns workspace-relative paths.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      pattern: z.string().describe("Glob pattern such as *.ts or src/**/*.json."),
      basePath: z.string().optional().describe("Base directory relative to workspace root to search in."),
      maxResults: z.number().int().optional().describe("Maximum results (default 100, max 1000)."),
    },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, pattern, basePath, maxResults }) => {
    try {
      const result = await globFiles(workspaces, { workspaceId, pattern, basePath, maxResults });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return errorResult("glob_files failed", error);
    }
  });

  registerAppTool(server, "search_text", {
    title: "Search text",
    description: "Search for text across workspace files. Returns file path, line, column, match snippet, and context lines.",
    inputSchema: {
      workspaceId: WORKSPACE_ID_SCHEMA,
      query: z.string().describe("Text or pattern to search for."),
      paths: z.array(z.string()).optional().describe("Limit search to these workspace-relative paths."),
      filePattern: z.string().optional().describe("Filter by file extension pattern, e.g. *.ts."),
      caseSensitive: z.boolean().optional().describe("Default false."),
      maxResults: z.number().int().optional().describe("Max matches (default 50, max 500)."),
    },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, query, paths, filePattern, caseSensitive, maxResults }) => {
    try {
      const result = await searchText(workspaces, { workspaceId, query, paths, filePattern, caseSensitive, maxResults });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return errorResult("search_text failed", error);
    }
  });

  registerAppTool(server, "inspect_project", {
    title: "Inspect project",
    description: "Detect project type, package managers, frameworks, and recommended build/run/test commands. Supports Node.js, TypeScript, .NET, Godot, Python, and Git.",
    inputSchema: { workspaceId: WORKSPACE_ID_SCHEMA, path: z.string().optional().describe("Subdirectory to inspect, relative to workspace root.") },
    ...toolWidgetDescriptorMeta(config, "search"), annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ workspaceId, path }) => {
    try {
      const result = await inspectProject(workspaces, { workspaceId, path });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return errorResult("inspect_project failed", error);
    }
  });
}
