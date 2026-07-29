import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNgrokArgs, extractNgrokPublicUrl, ngrokWindowsDownloadUrl, startNgrokTunnel } from "./ngrok-tunnel.js";
import { isGeneratedNgrokUrl, normalizeNgrokUrl, tunnelUrlMatchesProvider } from "./tunnel-utils.js";

assert.equal(normalizeNgrokUrl("demo.ngrok.app"), "https://demo.ngrok.app");
assert.equal(normalizeNgrokUrl("https://api.example.com/"), "https://api.example.com");
assert.throws(() => normalizeNgrokUrl("http://demo.ngrok.app"), /HTTPS/);
assert.throws(() => normalizeNgrokUrl("https://demo.ngrok.app/path"), /origin/);
assert.equal(isGeneratedNgrokUrl("https://abc.ngrok-free.app"), true);
assert.equal(isGeneratedNgrokUrl("https://api.example.com"), false);
assert.equal(tunnelUrlMatchesProvider("https://api.example.com", "ngrok", "api.example.com"), true);
assert.equal(tunnelUrlMatchesProvider("https://other.example.com", "ngrok", "api.example.com"), false);

assert.deepEqual(buildNgrokArgs(49321, "demo.ngrok.app"), [
  "http",
  "49321",
  "--log=stdout",
  "--log-format=json",
  "--url",
  "https://demo.ngrok.app",
]);
assert.equal(
  extractNgrokPublicUrl('{"lvl":"info","msg":"started tunnel","url":"https://test.ngrok-free.app"}'),
  "https://test.ngrok-free.app",
);
assert.equal(
  extractNgrokPublicUrl('{"url":"https://api.example.com"}', "https://api.example.com"),
  "https://api.example.com",
);
assert.equal(extractNgrokPublicUrl('{"url":"https://unrelated.example.com"}'), undefined);
assert.equal(ngrokWindowsDownloadUrl("x64"), "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip");
assert.equal(ngrokWindowsDownloadUrl("arm64"), "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-arm64.zip");

const tempRoot = await mkdtemp(join(tmpdir(), "auvrynt-ngrok-test-"));
const fakeAgent = join(tempRoot, "fake-ngrok-agent.mjs");
await writeFile(fakeAgent, `
const urlIndex = process.argv.indexOf("--url");
const url = urlIndex >= 0 ? process.argv[urlIndex + 1] : "https://fake-agent.ngrok-free.app";
console.log(JSON.stringify({ lvl: "info", msg: "started tunnel", url }));
setInterval(() => {}, 1000);
`, "utf8");

try {
  const assigned = await startNgrokTunnel(49321, {
    executable: process.execPath,
    executableArgsPrefix: [fakeAgent],
    timeoutMs: 5_000,
  });
  assert.equal(assigned.url, "https://fake-agent.ngrok-free.app");
  assigned.process.kill();

  const stable = await startNgrokTunnel(49321, {
    executable: process.execPath,
    executableArgsPrefix: [fakeAgent],
    url: "https://stable.example.com",
    authtoken: "test-token",
    timeoutMs: 5_000,
  });
  assert.equal(stable.url, "https://stable.example.com");
  stable.process.kill();

  const detachedLog = join(tempRoot, "ngrok.log");
  const detached = await startNgrokTunnel(49321, {
    executable: process.execPath,
    executableArgsPrefix: [fakeAgent],
    detached: true,
    logPath: detachedLog,
    timeoutMs: 5_000,
  });
  assert.equal(detached.url, "https://fake-agent.ngrok-free.app");
  detached.process.kill();
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("ngrok tunnel tests passed!");
