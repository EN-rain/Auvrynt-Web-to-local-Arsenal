import { spawn } from "node:child_process";

const MAX_COMMAND_LENGTH = 512;
const MAX_OUTPUT_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

export interface DashboardCommandResult {
  command: string;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface ParsedAuvryntDashboardCommand {
  args: string[];
  env: Record<string, string>;
}

export async function selectNativeWorkspaceFolder(initialPath: string): Promise<string | undefined> {
  if (process.platform === "win32") return selectWindowsFolder(initialPath);
  if (process.platform === "darwin") {
    const script = 'POSIX path of (choose folder with prompt "Choose Auvrynt workspace")';
    return cleanSelectedPath(await runPicker("osascript", ["-e", script], initialPath));
  }

  try {
    const zenity = await runPicker(
      "zenity",
      ["--file-selection", "--directory", "--title=Choose Auvrynt workspace", `--filename=${withTrailingSeparator(initialPath)}`],
      initialPath,
    );
    return cleanSelectedPath(zenity);
  } catch (error) {
    if (!isMissingExecutable(error)) throw error;
  }

  try {
    const kdialog = await runPicker(
      "kdialog",
      ["--getexistingdirectory", initialPath, "--title", "Choose Auvrynt workspace"],
      initialPath,
    );
    return cleanSelectedPath(kdialog);
  } catch (error) {
    if (!isMissingExecutable(error)) throw error;
  }
  throw new Error("No native folder picker is available. Install zenity or kdialog.");
}

export function parseAuvryntDashboardCommand(command: string): ParsedAuvryntDashboardCommand {
  const trimmed = command.trim();
  if (!trimmed) throw new Error("Enter an Auvrynt command.");
  if (trimmed.length > MAX_COMMAND_LENGTH) throw new Error(`Command exceeds ${MAX_COMMAND_LENGTH} characters.`);

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < trimmed.length; index++) {
    const char = trimmed[index];
    const next = trimmed[index + 1];
    if (char === "\\" && quote !== "'" && next) {
      const escapable = next === "\\"
        || next === '"'
        || (!quote && (next === "'" || /\s/.test(next)));
      if (escapable) {
        current += next;
        index++;
        continue;
      }
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Command contains an unclosed quote.");
  if (current) tokens.push(current);
  const auvryntIndex = tokens.findIndex((token) => token.toLowerCase() === "auvrynt");
  if (auvryntIndex < 0) {
    throw new Error("Only Auvrynt CLI commands are allowed here. Include `auvrynt` after any AUVRYNT_ environment assignments.");
  }
  const commandEnv: Record<string, string> = {};
  for (const assignment of tokens.slice(0, auvryntIndex)) {
    const match = assignment.match(/^(AUVRYNT_[A-Z0-9_]+)=(.*)$/);
    if (!match) throw new Error("Only AUVRYNT_ environment assignments may appear before `auvrynt`.");
    if (isSensitiveName(match[1])) {
      throw new Error("Sensitive token, authentication, and password environment values are not allowed in the dashboard terminal.");
    }
    commandEnv[match[1]] = match[2];
  }
  return { args: tokens.slice(auvryntIndex + 1), env: commandEnv };
}

export function assertDashboardCommandSupported(args: string[]): void {
  const command = args[0]?.toLowerCase() ?? "";
  if (!command) throw new Error("Choose a specific non-interactive Auvrynt subcommand, such as `auvrynt status`.");
  const blocked = new Map<string, string>([
    ["serve", "`auvrynt serve` cannot run inside the already-running dashboard server."],
    ["token", "Token commands are hidden from the dashboard for security. Run them in a local terminal."],
    ["uninstall", "Uninstall is not available from the dashboard terminal."],
    ["init", "Interactive setup commands must run in a local terminal."],
    ["setup", "Interactive setup commands must run in a local terminal."],
    ["enable", "Use the Connectivity tab or a local terminal for interactive integration selection."],
    ["disable", "Use the Connectivity tab or a local terminal for interactive integration selection."],
    ["tunnel", "Interactive tunnel selection must run in a local terminal."],
    ["change", "Use the Connectivity workspace picker so the selected folder is applied safely."],
    ["restart", "Use the dashboard Restart button so reconnection is handled correctly."],
    ["stop", "Use the dashboard Stop button so shutdown is handled correctly."],
  ]);
  const reason = blocked.get(command);
  if (reason) throw new Error(reason);
  if (command === "config" && args[1]?.toLowerCase() === "get") {
    throw new Error("Configuration output may contain local secrets. Run `auvrynt config get` in a local terminal.");
  }
  if (command === "config" && args[1]?.toLowerCase() === "set" && isSensitiveName(args[2] ?? "")) {
    throw new Error("Sensitive configuration values must be changed from a local terminal.");
  }
}

export async function runAuvryntDashboardCommand(
  command: string,
  cwd: string,
  entrypoint = process.argv[1],
): Promise<DashboardCommandResult> {
  if (!entrypoint) throw new Error("Auvrynt CLI entrypoint is unavailable.");
  const parsed = parseAuvryntDashboardCommand(command);
  assertDashboardCommandSupported(parsed.args);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...parsed.args], {
      cwd,
      env: { ...process.env, ...parsed.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer | string) => {
      if (Buffer.byteLength(output) >= MAX_OUTPUT_BYTES) return;
      output += String(chunk);
      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
        output = Buffer.from(output).subarray(0, MAX_OUTPUT_BYTES).toString("utf8") + "\n… output truncated …\n";
      }
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, COMMAND_TIMEOUT_MS);
    timer.unref();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        command: command.trim(),
        output: output.trimEnd() || (timedOut ? "Command timed out." : "Command completed with no output."),
        exitCode,
        timedOut,
      });
    });
  });
}

async function selectWindowsFolder(initialPath: string): Promise<string | undefined> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.ShowInTaskbar = $false",
    "$owner.TopMost = $true",
    "$owner.StartPosition = 'CenterScreen'",
    "$owner.Size = New-Object System.Drawing.Size(1,1)",
    "$owner.Opacity = 0",
    "$owner.Show()",
    "$owner.Activate()",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    "$dialog.Title = 'Choose Auvrynt workspace'",
    "$dialog.Filter = 'Folders|*.folder'",
    "$dialog.CheckFileExists = $false",
    "$dialog.CheckPathExists = $true",
    "$dialog.ValidateNames = $false",
    "$dialog.DereferenceLinks = $true",
    "$dialog.Multiselect = $false",
    "$dialog.RestoreDirectory = $false",
    "$dialog.FileName = 'Select this folder'",
    "if (Test-Path $env:AUVRYNT_PICKER_INITIAL) { $dialog.InitialDirectory = $env:AUVRYNT_PICKER_INITIAL }",
    "$result = $dialog.ShowDialog($owner)",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write([System.IO.Path]::GetDirectoryName($dialog.FileName)) }",
    "$dialog.Dispose()",
    "$owner.Close()",
    "$owner.Dispose()",
  ].join("; ");

  try {
    return cleanSelectedPath(await runPicker("powershell.exe", ["-NoProfile", "-STA", "-Command", script], initialPath));
  } catch (error) {
    if (isMissingExecutable(error)) {
      throw new Error("Windows PowerShell is unavailable, so the native workspace picker cannot be opened.");
    }
    throw error;
  }
}

function runPicker(
  executable: string,
  args: string[],
  initialPath: string,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...process.env, AUVRYNT_PICKER_INITIAL: initialPath },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    let settled = false;
    const finish = (result: string | undefined, error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(result);
    };
    child.once("error", (error) => finish(undefined, error));
    child.once("close", (code) => {
      if (code === 0) {
        finish(stdout);
        return;
      }
      if (pickerWasCanceled(code, stdout, stderr)) {
        finish(undefined);
        return;
      }
      finish(undefined, new Error(stderr.trim() || `${executable} exited with code ${code}.`));
    });
  });
}

function cleanSelectedPath(value: string | undefined): string | undefined {
  const path = value?.trim();
  return path || undefined;
}

function pickerWasCanceled(code: number | null, stdout: string, stderr: string): boolean {
  if (stdout.trim()) return false;
  if (code === 1 && !stderr.trim()) return true;
  return /user canceled|user cancelled|\(-128\)/i.test(stderr);
}

function isMissingExecutable(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function withTrailingSeparator(path: string): string {
  return /[\\/]$/.test(path) ? path : `${path}/`;
}

function isSensitiveName(value: string): boolean {
  return /(TOKEN|SECRET|PASSWORD|OWNER|AUTH|PRIVATE|CREDENTIAL)/i.test(value);
}
