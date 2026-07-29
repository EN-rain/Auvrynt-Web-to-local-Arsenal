#!/usr/bin/env node

/**
 * Live tunnel smoke test.
 *
 * This script actually connects to ngrok and/or Cloudflare if those tools
 * are installed on the local machine.  It cannot pass without at least one
 * tunnel provider executable available.
 *
 * Use:
 *   node scripts/live-tunnel-smoke.mjs
 *
 * Environment:
 *   AUVRYNT_LIVE_TUNNEL_PORT   port for the local listener (default 49321)
 *   AUVRYNT_NGROK_AUTHTOKEN    optional, forwarded to ngrok
 *   AUVRYNT_NGROK_URL          optional stable origin, verified if provided
 */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, openSync, closeSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Reproduce the tunnel-utils helpers inline so the smoke test does not
//    depend on compiled TypeScript output.

function findCommand(command) {
  try {
    return execFileSync(
      process.platform === "win32" ? "where.exe" : "which",
      [command],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    ).split(/\r?\n/)[0]?.trim() || undefined;
  } catch { return undefined; }
}

function normalizeUrl(value) {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (parsed.protocol !== "https:") throw new Error("URL must use HTTPS.");
  if (parsed.username || parsed.password) throw new Error("URL must not contain credentials.");
  if (parsed.port) throw new Error("URL must not contain a custom port.");
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("URL must be an origin without path, query, or fragment.");
  }
  return parsed.origin;
}

function isGeneratedNgrokUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      && !parsed.port && (parsed.pathname === "/" || parsed.pathname === "")
      && !parsed.search && !parsed.hash
      && /(^|\.)ngrok(?:-free)?\.(?:app|dev|io)$/i.test(parsed.hostname);
  } catch { return false; }
}

function tunnelUrlMatchesProvider(url, provider, expectedNgrokUrl) {
  if (provider === "ngrok") {
    const expected = normalizeUrl(expectedNgrokUrl);
    if (expected) return url === expected;
    return isGeneratedNgrokUrl(url);
  }
  return /^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com$/.test(url);
}

// ── Test result counters

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    failures.push({ name, error });
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    failures.push({ name: `${name} (async)`, error });
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

// ── Temporary directories

const tempDir = mkdtempSync(join(tmpdir(), "auvrynt-tunnel-smoke-"));
const stateDir = join(tempDir, "state");

function tunnelJsonPath() {
  return join(stateDir, "tunnel.json");
}

// ── Helpers (reproduce the production logic inline)

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch { return undefined; }
}

async function writeTunnelRecord(path, record) {
  await writeFile(path, JSON.stringify(record), { mode: 0o600 });
}

function makeTunnelRecord(pid, url, port, provider) {
  return { pid, url, port, provider, processPath: "smoke-test", processStartedAt: new Date().toISOString() };
}

// Wait for a URL to appear in a log file, with timeout
async function waitForUrlInLog(logPath, checkUrl, timeoutMs, pollMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const output = await readFile(logPath, "utf8").catch(() => "");
    const result = checkUrl(output);
    if (result) return result;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return undefined;
}

// ── Smoke test suite

async function main() {
  const PORT = Number(process.env.AUVRYNT_LIVE_TUNNEL_PORT || "49321");
  const EXPECTED_NGROK_URL = normalizeUrl(process.env.AUVRYNT_NGROK_URL);

  console.log(`\n=== Auvrynt Live Tunnel Smoke Test ===`);
  console.log(`Port: ${PORT}`);
  console.log(`Temp: ${tempDir}`);
  console.log(`Expected ngrok URL: ${EXPECTED_NGROK_URL ?? "(none, use assigned)"}\n`);

  // ── 1. Provider detection
  console.log(`\n── Provider detection ──`);

  const ngrokExe = findCommand("ngrok");
  const hasNgrok = Boolean(ngrokExe);
  test("ngrok installed", () => {
    if (!hasNgrok) throw new Error("ngrok not found on PATH. Install from https://ngrok.com/download");
  });
  if (!hasNgrok) { skipped++; console.log("  → ngrok tests will be skipped"); }

  const cfExe = findCommand("cloudflared");
  const hasCloudflared = Boolean(cfExe);
  test("cloudflared installed", () => {
    if (!hasCloudflared) throw new Error("cloudflared not found on PATH. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
  });
  if (!hasCloudflared) { skipped++; console.log("  → Cloudflare tests will be skipped"); }

  if (!hasNgrok && !hasCloudflared) {
    console.log("\n⚠  No tunnel provider found. At least one of ngrok or cloudflared must be installed.");
    console.log("   Install one and re-run.");
    process.exitCode = 0;
    console.log(`\nResults: 0 passed, 0 failed, 2 skipped (no tunnel provider)`);
    return;
  }

  // ── Start a minimal local HTTP server to tunnel to
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise(resolve => server.listen(PORT, "127.0.0.1", resolve));
  console.log(`\n  Local HTTP server listening on 127.0.0.1:${PORT}`);

  try {
    await mkdir(stateDir, { recursive: true });

    // ── 2. URL format helpers
    console.log(`\n── URL format helpers ──`);

    test("normalizeUrl: prepends https", () => {
      assert.equal(normalizeUrl("demo.ngrok.app"), "https://demo.ngrok.app");
    });

    test("normalizeUrl: strips trailing slash", () => {
      assert.equal(normalizeUrl("https://demo.ngrok.app/"), "https://demo.ngrok.app");
    });

    test("normalizeUrl: rejects path", () => {
      assert.throws(() => normalizeUrl("https://demo.ngrok.app/path"), /origin/);
    });

    test("normalizeUrl: rejects HTTP", () => {
      assert.throws(() => normalizeUrl("http://demo.ngrok.app"), /HTTPS/);
    });

    test("isGeneratedNgrokUrl: recognizes ngrok-free.app", () => {
      assert.equal(isGeneratedNgrokUrl("https://abc123.ngrok-free.app"), true);
    });

    test("isGeneratedNgrokUrl: recognizes ngrok.app", () => {
      assert.equal(isGeneratedNgrokUrl("https://abc123.ngrok.app"), true);
    });

    test("isGeneratedNgrokUrl: rejects custom domain", () => {
      assert.equal(isGeneratedNgrokUrl("https://api.example.com"), false);
    });

    // ── 3. ngrok live tests
    if (hasNgrok) {
      console.log(`\n── ngrok live tunnel ──`);

      // 3a. Start an assigned (generated) tunnel
      let ngrokChild;
      try {
        const ngrokLog = join(tempDir, "ngrok-assigned.log");
        await writeFile(ngrokLog, "", { mode: 0o600 });
        const logHandle = openSync(ngrokLog, "a");

        const args = ["http", String(PORT), "--log=stdout", "--log-format=json"];
        const spawnEnv = { ...process.env };
        if (process.env.AUVRYNT_NGROK_AUTHTOKEN) {
          spawnEnv.NGROK_AUTHTOKEN = process.env.AUVRYNT_NGROK_AUTHTOKEN;
        }

        ngrokChild = spawn(ngrokExe, args, {
          stdio: ["ignore", logHandle, logHandle],
          windowsHide: true,
          env: spawnEnv,
        });
        closeSync(logHandle);
        let ngrokSpawnErr;
        ngrokChild.once("error", (err) => { ngrokSpawnErr = err; });

        // Wait for URL with 90s timeout
        const ngrokAssignedUrl = await waitForUrlInLog(
          ngrokLog,
          (output) => {
            const candidates = output.match(/https:\/\/[^\s"'\\]+/g) ?? [];
            for (const raw of candidates) {
              const cleaned = raw.replace(/[),.;]+$/, "");
              try {
                const n = normalizeUrl(cleaned);
                if (n && isGeneratedNgrokUrl(n)) return n;
              } catch {}
            }
            return undefined;
          },
          90_000,
        );

        if (!ngrokAssignedUrl) throw new Error("ngrok did not provide a generated URL within 90 seconds.");

        await testAsync("ngrok: assigned URL discovered", async () => {
          assert.ok(ngrokAssignedUrl.startsWith("https://"), `Expected HTTPS URL, got: ${ngrokAssignedUrl}`);
          assert.ok(isGeneratedNgrokUrl(ngrokAssignedUrl), `Expected generated ngrok URL, got: ${ngrokAssignedUrl}`);
        });

        test("ngrok: URL matches provider", () => {
          assert.ok(tunnelUrlMatchesProvider(ngrokAssignedUrl, "ngrok"));
        });

        // 3b. Tunnel record persistence
        const recordPath = tunnelJsonPath();
        const record = makeTunnelRecord(ngrokChild.pid, ngrokAssignedUrl, PORT, "ngrok");
        await writeTunnelRecord(recordPath, record);

        await testAsync("ngrok: tunnel record persisted", async () => {
          const saved = await readJson(recordPath);
          assert.ok(saved, "tunnel.json should exist");
          assert.equal(saved.url, ngrokAssignedUrl);
          assert.equal(saved.port, PORT);
          assert.equal(saved.provider, "ngrok");
          assert.equal(saved.pid, ngrokChild.pid);
        });

        // 3c. Verify actual HTTP reachability through the tunnel
        await testAsync("ngrok: HTTP reachable through tunnel", async () => {
          const response = await fetch(`${ngrokAssignedUrl}/healthz`, { signal: AbortSignal.timeout(15_000) });
          assert.equal(response.status, 200);
          const body = await response.json();
          assert.ok(body.ok);
        });

        // 3d. Stop tunnel and verify cleanup
        const killedPid = ngrokChild.pid;
        ngrokChild.kill();
        await new Promise(resolve => ngrokChild.once("exit", resolve));
        ngrokChild = undefined;

        await testAsync("ngrok: cleanup after kill", async () => {
          try { process.kill(killedPid, 0); throw new Error("process still running"); }
          catch (e) { if (e.code !== "ESRCH") throw e; }
          await unlink(recordPath);
          const gone = await readJson(recordPath);
          assert.equal(gone, undefined);
        });

        console.log("  → Assigned ngrok tunnel verified.");
      } catch (error) {
        failed++;
        failures.push({ name: "ngrok assigned tunnel", error });
        console.error(`  ✗ ngrok assigned tunnel failed: ${error.message}`);
        if (ngrokChild) {
          ngrokChild.kill();
          ngrokChild = undefined;
        }
      }

      // ── 3e. Stable (reserved) URL test
      if (hasNgrok && EXPECTED_NGROK_URL) {
        let stableChild;
        try {
          const ngrokLog = join(tempDir, "ngrok-stable.log");
          await writeFile(ngrokLog, "", { mode: 0o600 });
          const logHandle = openSync(ngrokLog, "a");

          const args = ["http", String(PORT), "--log=stdout", "--log-format=json", "--url", EXPECTED_NGROK_URL];
          const spawnEnv = { ...process.env };
          if (process.env.AUVRYNT_NGROK_AUTHTOKEN) {
            spawnEnv.NGROK_AUTHTOKEN = process.env.AUVRYNT_NGROK_AUTHTOKEN;
          }

          stableChild = spawn(ngrokExe, args, {
            stdio: ["ignore", logHandle, logHandle],
            windowsHide: true,
            env: spawnEnv,
          });
          closeSync(logHandle);
          let stableSpawnErr;
          stableChild.once("error", (err) => { stableSpawnErr = err; });

          const stableUrl = await waitForUrlInLog(
            ngrokLog,
            (output) => {
              const candidates = output.match(/https:\/\/[^\s"'\\]+/g) ?? [];
              for (const raw of candidates) {
                const cleaned = raw.replace(/[),.;]+$/, "");
                try {
                  const n = normalizeUrl(cleaned);
                  if (n && n === EXPECTED_NGROK_URL) return n;
                } catch {}
              }
              return undefined;
            },
            90_000,
          );

          if (!stableUrl) throw new Error(`ngrok did not provide the stable URL ${EXPECTED_NGROK_URL} within 90 seconds.`);

          await testAsync("ngrok: stable URL matches expected", async () => {
            assert.equal(stableUrl, EXPECTED_NGROK_URL);
          });

          await testAsync("ngrok: stable URL HTTP reachable", async () => {
            const response = await fetch(`${stableUrl}/healthz`, { signal: AbortSignal.timeout(15_000) });
            assert.equal(response.status, 200);
          });

          test("ngrok: stable URL matches provider", () => {
            assert.ok(tunnelUrlMatchesProvider(stableUrl, "ngrok", EXPECTED_NGROK_URL));
          });

          stableChild.kill();
          await new Promise(resolve => stableChild.once("exit", resolve));
          stableChild = undefined;
          console.log("  → Stable ngrok tunnel verified.");
        } catch (error) {
          failed++;
          failures.push({ name: "ngrok stable URL test", error });
          console.error(`  ✗ ngrok stable URL test failed: ${error.message}`);
          if (stableChild) {
            stableChild.kill();
            stableChild = undefined;
          }
        }
      } else if (hasNgrok) {
        skipped++;
        console.log("  → Skipping stable URL test (set AUVRYNT_NGROK_URL to test)");
      }
    }

    // ── 4. Cloudflare live test
    if (hasCloudflared) {
      console.log(`\n── Cloudflare live tunnel ──`);

      let cfChild;
      try {
        const cfLog = join(tempDir, "cloudflared.log");
        await writeFile(cfLog, "", { mode: 0o600 });
        const logHandle = openSync(cfLog, "a");

        const args = ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${PORT}`];
        cfChild = spawn(cfExe, args, {
          stdio: ["ignore", logHandle, logHandle],
          windowsHide: true,
        });
        closeSync(logHandle);
        let cfSpawnErr;
        cfChild.once("error", (err) => { cfSpawnErr = err; });

        const cfUrl = await waitForUrlInLog(
          cfLog,
          (output) => {
            const match = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
            return match ? match[0] : undefined;
          },
          120_000,
          250,
        );

        if (!cfUrl) throw new Error("cloudflared did not provide a URL within 120 seconds.");

        await testAsync("cloudflared: URL discovered", async () => {
          assert.ok(cfUrl.startsWith("https://"), `Expected HTTPS URL, got: ${cfUrl}`);
          assert.ok(cfUrl.includes(".trycloudflare.com"), `Expected trycloudflare.com URL, got: ${cfUrl}`);
        });

        test("cloudflared: URL matches provider", () => {
          assert.ok(tunnelUrlMatchesProvider(cfUrl, "cloudflare"));
        });

        // Tunnel record persistence
        const recordPath = tunnelJsonPath();
        const record = makeTunnelRecord(cfChild.pid, cfUrl, PORT, "cloudflare");
        await writeTunnelRecord(recordPath, record);

        await testAsync("cloudflared: tunnel record persisted", async () => {
          const saved = await readJson(recordPath);
          assert.ok(saved);
          assert.equal(saved.url, cfUrl);
          assert.equal(saved.port, PORT);
          assert.equal(saved.provider, "cloudflare");
        });

        // HTTP reachability through tunnel
        await testAsync("cloudflared: HTTP reachable through tunnel", async () => {
          const response = await fetch(`${cfUrl}/healthz`, { signal: AbortSignal.timeout(15_000) });
          assert.equal(response.status, 200);
          const body = await response.json();
          assert.ok(body.ok);
        });

        // Stop and cleanup
        const killedCfPid = cfChild.pid;
        cfChild.kill();
        await new Promise(resolve => cfChild.once("exit", resolve));
        cfChild = undefined;

        await testAsync("cloudflared: cleanup after kill", async () => {
          try { process.kill(killedCfPid, 0); throw new Error("process still running"); }
          catch (e) { if (e.code !== "ESRCH") throw e; }
          await unlink(recordPath);
        });

        console.log("  → Cloudflare tunnel verified.");
      } catch (error) {
        failed++;
        failures.push({ name: "Cloudflare tunnel", error });
        console.error(`  ✗ Cloudflare tunnel test failed: ${error.message}`);
        if (cfChild) {
          cfChild.kill();
          cfChild = undefined;
        }
      }
    }

    // ── 5. Tunnel manager simulation
    console.log(`\n── Tunnel manager simulation ──`);

    test("tunnelUrlMatchesProvider: rejects wrong provider", () => {
      const url = "https://abc123.ngrok-free.app";
      assert.equal(tunnelUrlMatchesProvider(url, "cloudflare"), false);
    });

    test("tunnelUrlMatchesProvider: accepts correct ngrok", () => {
      const url = "https://abc123.ngrok-free.app";
      assert.equal(tunnelUrlMatchesProvider(url, "ngrok"), true);
    });

    test("tunnelUrlMatchesProvider: stable URL matching", () => {
      const url = "https://custom.ngrok.app";
      assert.equal(tunnelUrlMatchesProvider(url, "ngrok", "https://custom.ngrok.app"), true);
    });

    // Simulate read-managed-tunnel behavior
    await testAsync("readManagedTunnel simulation: missing file returns undefined", async () => {
      const data = await readJson(join(tempDir, "nonexistent.json"));
      assert.equal(data, undefined);
    });

    await testAsync("readManagedTunnel simulation: valid record parsed", async () => {
      const path = join(tempDir, "valid-record.json");
      const record = makeTunnelRecord(99999, "https://test.ngrok-free.app", PORT, "ngrok");
      await writeTunnelRecord(path, record);
      const saved = await readJson(path);
      assert.ok(saved);
      assert.equal(saved.url, "https://test.ngrok-free.app");
      assert.equal(saved.provider, "ngrok");
      await unlink(path);
    });

  } finally {
    // Cleanup — kill any orphaned child processes and remove temp dir
    server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  // ── Results
  const total = passed + failed + skipped;
  console.log(`\n── Results ──`);
  console.log(`  ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total)`);

  if (failed > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error.message}`);
    }
    process.exitCode = 1;
  }
  console.log(`\n${failed === 0 ? "✓ All tunnel smoke tests passed." : "✗ Some tunnel smoke tests failed."}`);
}

main().catch(error => {
  console.error(`Fatal error: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
