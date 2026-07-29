import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

async function lines(path: string): Promise<number> {
  return (await readFile(path, "utf8")).split(/\r?\n/).length;
}

assert.ok(await lines("src/server.ts") <= 750, "server.ts grew past the HTTP composition boundary");
assert.ok(await lines("src/cli.ts") <= 250, "cli.ts grew past the command-router boundary");
assert.ok(await lines("src/server/mcp-server-factory.ts") <= 250, "MCP factory grew past its composition boundary");
assert.ok(await lines("src/cli/foreground-server.ts") <= 500, "foreground server runtime grew past its boundary");
assert.ok(await lines("src/cli/lifecycle-manager.ts") <= 550, "CLI lifecycle manager grew past its boundary");
assert.ok(await lines("src/server/mcp-policy.ts") > 20);
assert.ok(await lines("src/server/mcp-tool-registrar.ts") > 40);
assert.ok(await lines("src/cli/runtime-support.ts") > 30);
assert.ok(await lines("src/cli/instance-control.ts") > 20);

const allowedEntrypoints = new Set(["cli.ts", "server.ts"]);
const rootFiles = (await readdir("src", { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
  .map((entry) => entry.name);

for (const file of rootFiles) {
  if (allowedEntrypoints.has(file) || file.endsWith(".test.ts")) continue;
  const content = (await readFile(`src/${file}`, "utf8")).trim();
  assert.match(
    content,
    /^export \* from "\.\/.+\.js";$/,
    `src/${file} must remain a compatibility facade; put implementations in a domain folder`,
  );
  assert.ok(content.split(/\r?\n/).length <= 2, `src/${file} facade is too large`);
}

for (const path of [
  "src/auth/oauth-provider.ts",
  "src/infrastructure/config.ts",
  "src/workspace/workspaces.ts",
  "src/process/processes.ts",
  "src/tools/pi-tools.ts",
  "src/integrations/images/image-tools.ts",
  "src/integrations/playwright/web-tools.ts",
  "src/integrations/dotnet/dotnet-tools.ts",
  "src/integrations/godot/godot-gdscript.ts",
  "src/integrations/blender/blender-client.ts",
  "src/integrations/blender/blender-tools.ts",
  "src/integrations/serena/serena-manager.ts",
  "src/integrations/serena/serena-tools.ts",
]) {
  assert.ok(await lines(path) > 0, `${path} is missing or empty`);
}

console.log("Architecture boundary tests passed!");
