import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config.js";
import { createReviewCheckpointManager } from "../review-checkpoints.js";
import { WorkspaceRegistry } from "../workspaces.js";
import { registerCoreFileTools } from "./tools/core-file-tools-registration.js";
import { createWorkspaceChangeTracker } from "./workspace-analytics.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-agent-analytics-"));
try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    AUVRYNT_MINIMAL_TOOLS: "true",
    PORT: "1",
  });
  const workspaces = new WorkspaceRegistry(config);
  const workspace = (await workspaces.openWorkspace(root)).workspace;
  const tracker = createWorkspaceChangeTracker();
  tracker.activateWorkspace(workspace.id, workspace.root);
  const server = new McpServer({ name: "analytics-test", version: "1.0.0" });

  registerCoreFileTools(
    server,
    config,
    workspaces,
    createReviewCheckpointManager(),
    {
      read: "read_file",
      write: "write_file",
      edit: "edit_file",
      grep: "grep_files",
      glob: "find_files",
      ls: "list_directory",
      shell: "run_shell",
    },
    tracker,
    () => undefined,
    () => undefined,
  );

  const tools = (server as any)._registeredTools as Record<string, { handler: Function }>;
  const auth = { authInfo: { clientId: "analytics-test", scopes: ["auvrynt:read", "auvrynt:write", "auvrynt:process"] } };
  await tools.write_file.handler({ workspaceId: workspace.id, path: "sample.ts", content: "one\ntwo\n" }, auth);
  assert.deepEqual(tracker.snapshot(), {
    workspaceId: workspace.id,
    workspaceRoot: workspace.root,
    filesCreated: 1,
    filesDeleted: 0,
    filesModified: 0,
    additions: 2,
    removals: 0,
    startedAt: tracker.snapshot().startedAt,
    sampledAt: tracker.snapshot().sampledAt,
  });

  await tools.write_file.handler({ workspaceId: workspace.id, path: "sample.ts", content: "one\nthree\nfour\n" }, auth);
  let snapshot = tracker.snapshot();
  assert.equal(snapshot.filesCreated, 1);
  assert.equal(snapshot.filesModified, 1);
  assert.equal(snapshot.additions, 4);
  assert.equal(snapshot.removals, 1);

  await tools.edit_file.handler({
    workspaceId: workspace.id,
    path: "sample.ts",
    edits: [{ oldText: "three", newText: "THREE\nextra" }],
  }, auth);
  snapshot = tracker.snapshot();
  assert.equal(snapshot.filesModified, 1, "modified files are counted uniquely");
  assert.equal(snapshot.additions, 6);
  assert.equal(snapshot.removals, 2);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Non-Git Auvrynt file mutation analytics tests passed!");
