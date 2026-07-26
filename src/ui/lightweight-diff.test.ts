import assert from "node:assert/strict";
import { parseUnifiedPatch } from "./lightweight-diff.js";

const patch = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  "diff --git a/src/old.ts b/src/new.ts",
  "similarity index 100%",
  "rename from src/old.ts",
  "rename to src/new.ts",
].join("\n");

const files = parseUnifiedPatch(patch);
assert.equal(files.length, 2);
assert.equal(files[0].name, "src/a.ts");
assert.equal(files[0].additions, 2);
assert.equal(files[0].removals, 1);
assert.equal(files[1].name, "src/new.ts");

const added = files[0].lines.filter((line) => line.kind === "add");
const removed = files[0].lines.filter((line) => line.kind === "remove");
assert.deepEqual(added.map((line) => line.newLine), [2, 3]);
assert.deepEqual(removed.map((line) => line.oldLine), [2]);

const newFilePatch = [
  "--- /dev/null",
  "+++ b/new.txt",
  "@@ -0,0 +1,2 @@",
  "+hello",
  "+world",
].join("\n");
const [newFile] = parseUnifiedPatch(newFilePatch);
assert.equal(newFile.name, "new.txt");
assert.equal(newFile.additions, 2);
assert.equal(newFile.removals, 0);
