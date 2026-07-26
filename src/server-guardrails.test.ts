import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { createServer, requiredScopesForToolCall, requiredScopesForToolName, toolIntegrationEnabled } from "./server.js";

const stateDir = await mkdtemp(join(tmpdir(), "auvrynt-server-guardrails-"));
const config = loadConfig({
  AUVRYNT_ALLOWED_ROOTS: process.cwd(),
  AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
  AUVRYNT_GODOT_GDSCRIPT_ENABLED: "0",
  AUVRYNT_GODOT_CSHARP_ENABLED: "1",
  AUVRYNT_BLENDER_ENABLED: "0",
  AUVRYNT_SERENA_ENABLED: "0",
  AUVRYNT_PLAYWRIGHT_ENABLED: "0",
  AUVRYNT_STATE_DIR: stateDir,
  PORT: "1",
});

assert.deepEqual(requiredScopesForToolName("read_file"), ["auvrynt:read"]);
assert.deepEqual(requiredScopesForToolName("write_file"), ["auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("start_process"), ["auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("start_dev_server"), ["auvrynt:web", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolName("capture_page_screenshot"), ["auvrynt:web", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("test_responsive_page"), ["auvrynt:web", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("capture_window"), ["auvrynt:process", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("split_sprite_sheet"), ["auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("dotnet_build"), ["auvrynt:software", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolCall("dotnet_format", { verifyOnly: true }), ["auvrynt:software", "auvrynt:process"]);
assert.deepEqual(requiredScopesForToolCall("dotnet_format", { verifyOnly: false }), ["auvrynt:software", "auvrynt:process", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolCall("compare_images", {}), ["auvrynt:read"]);
assert.deepEqual(requiredScopesForToolCall("compare_images", { diffOutputPath: "diff.png" }), ["auvrynt:read", "auvrynt:write"]);
assert.deepEqual(requiredScopesForToolName("blender_get_scene_info"), ["auvrynt:blender"]);
assert.deepEqual(requiredScopesForToolName("blender_execute_python"), ["auvrynt:blender", "auvrynt:blender-python"]);
assert.deepEqual(requiredScopesForToolName("godot_get_scene_tree"), ["auvrynt:godot"]);
assert.deepEqual(requiredScopesForToolName("serena_find_symbol"), ["auvrynt:serena"]);

assert.equal(toolIntegrationEnabled(config, "blender_get_scene_info"), false);
assert.equal(toolIntegrationEnabled(config, "inspect_page"), false);
assert.equal(toolIntegrationEnabled(config, "godot_gdscript_environment"), false);
assert.equal(toolIntegrationEnabled(config, "godot_dotnet_environment"), true);
assert.equal(toolIntegrationEnabled(config, "serena_find_symbol"), false);
assert.equal(toolIntegrationEnabled(config, "read_file"), true);

const running = createServer(config);
try {
  const update = await running.updateIntegrations({
    godotGdscript: false,
    godotCsharp: false,
    blender: true,
    serena: false,
    playwright: true,
  });
  assert.equal(update.updated, true);
  assert.equal(running.config.integrations.blender, true);
  assert.equal(running.config.integrations.playwright, true);
  assert.equal(toolIntegrationEnabled(running.config, "blender_get_scene_info"), true);
  assert.equal(toolIntegrationEnabled(running.config, "inspect_page"), true);
} finally {
  await running.close();
  await rm(stateDir, { recursive: true, force: true });
}
