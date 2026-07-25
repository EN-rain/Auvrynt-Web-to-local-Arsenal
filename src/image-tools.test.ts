import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { inspectImage, compareImages, inspectSprite, splitSpriteSheet } from "./image-tools.js";

const root = await mkdtemp(join(tmpdir(), "auvrynt-img-test-"));

try {
  const config = loadConfig({
    AUVRYNT_ALLOWED_ROOTS: root,
    AUVRYNT_OAUTH_OWNER_TOKEN: "test-owner-token-that-is-long-enough",
    PORT: "1",
  });
  const registry = new WorkspaceRegistry(config);
  const { workspace } = await registry.openWorkspace(root);
  const workspaceId = workspace.id;

  // Minimal valid PNG buffer
  const pngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
    0x00, 0x00, 0x00, 0x0d, // IHDR length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x40, // Width = 64
    0x00, 0x00, 0x00, 0x40, // Height = 64
    0x08, 0x06, 0x00, 0x00, 0x00,
  ]);

  await writeFile(join(root, "test1.png"), pngBytes);
  await writeFile(join(root, "test2.png"), pngBytes);

  // 1. inspectImage
  const inspRes = await inspectImage(registry, { workspaceId, path: "test1.png" });
  assert.equal(inspRes.isError, undefined);
  const inspData = JSON.parse(inspRes.content[0].type === "text" ? inspRes.content[0].text : "{}");
  assert.equal(inspData.width, 64);
  assert.equal(inspData.height, 64);
  assert.equal(inspData.mimeType, "image/png");

  // 2. compareImages
  const compRes = await compareImages(registry, {
    workspaceId,
    referencePath: "test1.png",
    candidatePath: "test2.png",
    diffOutputPath: "diff.png",
  });
  assert.equal(compRes.isError, undefined);
  const compData = JSON.parse(compRes.content.find((c) => c.type === "text")?.text ?? "{}");
  assert.equal(compData.dimensionsMatch, true);
  assert.equal(compData.isExactByteMatch, true);
  assert.equal(compData.exactMatchPercentage, 100);

  // 3. inspectSprite
  const spriteRes = await inspectSprite(registry, { workspaceId, path: "test1.png", expectedCellWidth: 32, expectedCellHeight: 32 });
  const spriteData = JSON.parse(spriteRes.content[0].type === "text" ? spriteRes.content[0].text : "{}");
  assert.equal(spriteData.possibleColumns, 2);
  assert.equal(spriteData.possibleRows, 2);

  // 4. splitSpriteSheet
  const splitRes = await splitSpriteSheet(registry, {
    workspaceId,
    path: "test1.png",
    columns: 2,
    rows: 2,
    outputDirectory: "frames",
  });
  assert.equal(splitRes.isError, undefined);
  assert.match(splitRes.content[0].type === "text" ? splitRes.content[0].text : "", /frame_0_0\.png/);
} finally {
  await rm(root, { recursive: true, force: true });
}
