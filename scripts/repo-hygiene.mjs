import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check") || !process.argv.includes("--fix");
const binaryExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
  ".blend", ".glb", ".wasm", ".sqlite", ".db", ".zip", ".tgz",
]);
const knownNulArtifact = "INFO: Could not find files for the given pattern(s).";

const git = spawnSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
});
if (git.status !== 0) {
  process.stderr.write(git.stderr || "Could not list tracked files.\n");
  process.exit(2);
}

const trackedFiles = git.stdout.split("\0").filter(Boolean);
const crlfFiles = [];

for (const relativePath of trackedFiles) {
  if (binaryExtensions.has(extname(relativePath).toLowerCase())) continue;
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) continue;

  const buffer = readFileSync(absolutePath);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  if (!text.includes("\r\n")) continue;

  crlfFiles.push(relativePath);
  if (!checkOnly) writeFileSync(absolutePath, text.replace(/\r\n/g, "\n"), "utf8");
}

let nulArtifact = false;
let unsafeNulArtifact = false;
if (process.platform === "win32") {
  const normalPath = join(root, "NUL");
  const extendedPath = `\\\\?\\${normalPath}`;
  if (existsSync(extendedPath)) {
    const content = readFileSync(extendedPath, "utf8").trim();
    if (content === knownNulArtifact) {
      nulArtifact = true;
      if (!checkOnly) unlinkSync(extendedPath);
    } else {
      unsafeNulArtifact = true;
    }
  }
}

if (checkOnly) {
  if (crlfFiles.length > 0) {
    console.error(`CRLF normalization required in ${crlfFiles.length} tracked file(s):`);
    for (const path of crlfFiles.slice(0, 20)) console.error(`  ${path}`);
    if (crlfFiles.length > 20) console.error(`  ...and ${crlfFiles.length - 20} more`);
  }
  if (nulArtifact) console.error("Known accidental Windows NUL artifact is present at repository root.");
  if (unsafeNulArtifact) console.error("A repository-root NUL file exists but does not match the known disposable artifact; it was not touched.");
  if (crlfFiles.length > 0 || nulArtifact || unsafeNulArtifact) process.exit(1);
  console.log("Repository hygiene check passed.");
} else {
  console.log(`Normalized ${crlfFiles.length} tracked file(s) to LF.`);
  console.log(nulArtifact ? "Removed the known accidental Windows NUL artifact." : "No known Windows NUL artifact needed removal.");
  if (unsafeNulArtifact) {
    console.warn("A repository-root NUL file exists but did not match the known disposable artifact; it was left untouched.");
    process.exitCode = 1;
  }
}
