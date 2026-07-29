import { spawn } from "node:child_process";

const [, , parentPidText, cliPath, encodedArgs] = process.argv;
const parentPid = Number(parentPidText);

if (!Number.isInteger(parentPid) || parentPid <= 0 || !cliPath || !encodedArgs) {
  process.exitCode = 2;
} else {
  const originalArgs = JSON.parse(Buffer.from(encodedArgs, "base64url").toString("utf8"));
  if (!Array.isArray(originalArgs) || originalArgs.some((value) => typeof value !== "string")) {
    process.exitCode = 2;
  } else {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && isRunning(parentPid)) {
      await delay(250);
    }

    if (isRunning(parentPid)) {
      console.error(`[auvrynt] Crash recovery abandoned because process ${parentPid} did not exit.`);
      process.exitCode = 1;
    } else {
      await delay(500);
      const child = spawn(process.execPath, [cliPath, ...originalArgs], {
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", "inherit", "inherit"],
        windowsHide: true,
        env: process.env,
      });
      child.once("error", (error) => {
        console.error(`[auvrynt] Crash recovery restart failed: ${error.message}`);
      });
      child.unref();
    }
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
