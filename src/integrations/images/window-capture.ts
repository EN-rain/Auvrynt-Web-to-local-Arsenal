import { readFile, mkdir } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";
import type { ToolResponse } from "../../pi-tools.js";
import { inlineImageOrNotice } from "../../tool-result-budget.js";

const execFileAsync = promisify(execFile);
const MAX_WINDOW_TITLE_CHARS = 256;

export interface CaptureWindowInput {
  workspaceId: string;
  processId?: string;
  windowTitle?: string;
  outputPath: string;
}

export async function captureWindow(
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  input: CaptureWindowInput,
): Promise<ToolResponse> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absoluteOutputPath = registry.resolveArtifactPath(workspace, input.outputPath, "captures");

  if (process.platform !== "win32") {
    return {
      content: [{
        type: "text",
        text: `Window capture is currently supported on Windows hosts. Operating system "${process.platform}" is not supported.`,
      }],
      isError: true,
    };
  }

  const title = input.windowTitle?.trim();
  if (!input.processId && !title) {
    return {
      content: [{ type: "text", text: "Window capture requires processId or windowTitle. Full-screen capture is intentionally disabled." }],
      isError: true,
    };
  }
  if (title && title.length > MAX_WINDOW_TITLE_CHARS) {
    return {
      content: [{ type: "text", text: `windowTitle exceeds ${MAX_WINDOW_TITLE_CHARS} characters.` }],
      isError: true,
    };
  }

  let pid: number | undefined;
  if (input.processId) {
    const tracked = processManager.getTrackedProcess(input.workspaceId, input.processId);
    if (tracked.status !== "running") {
      return {
        content: [{ type: "text", text: `Tracked process ${input.processId} is not running.` }],
        isError: true,
      };
    }
    pid = tracked.pid;
    if (!pid) {
      return {
        content: [{ type: "text", text: `Tracked process ${input.processId} does not have a process ID.` }],
        isError: true,
      };
    }
  }

  const psScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AuvryntNativeWindow {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
}
"@

function Find-WindowForProcess([int]$RootPid) {
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $seen = [System.Collections.Generic.HashSet[int]]::new()
    $queue.Enqueue($RootPid)
    while ($queue.Count -gt 0) {
        $currentPid = $queue.Dequeue()
        if (-not $seen.Add($currentPid)) { continue }
        $proc = Get-Process -Id $currentPid -ErrorAction SilentlyContinue
        if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) { return $proc.MainWindowHandle }
        Get-CimInstance Win32_Process -Filter "ParentProcessId=$currentPid" -ErrorAction SilentlyContinue | ForEach-Object {
            $queue.Enqueue([int]$_.ProcessId)
        }
    }
    return [IntPtr]::Zero
}

$handle = [IntPtr]::Zero
if ($env:AUVRYNT_CAPTURE_PID) {
    $handle = Find-WindowForProcess ([int]$env:AUVRYNT_CAPTURE_PID)
}
if ($handle -eq [IntPtr]::Zero -and $env:AUVRYNT_CAPTURE_TITLE) {
    $needle = $env:AUVRYNT_CAPTURE_TITLE
    $proc = Get-Process | Where-Object {
        $_.MainWindowHandle -ne [IntPtr]::Zero -and
        $_.MainWindowTitle.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object -First 1
    if ($proc) { $handle = $proc.MainWindowHandle }
}
if ($handle -eq [IntPtr]::Zero) { throw 'Target application window was not found.' }

$rect = New-Object AuvryntNativeWindow+RECT
if (-not [AuvryntNativeWindow]::GetWindowRect($handle, [ref]$rect)) { throw 'Could not read target window bounds.' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 1 -or $height -lt 1 -or $width -gt 16384 -or $height -gt 16384) {
    throw "Invalid target window bounds: $($width)x$($height)"
}

$bmp = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
try {
    $hdc = $graphics.GetHdc()
    try { $printed = [AuvryntNativeWindow]::PrintWindow($handle, $hdc, 2) }
    finally { $graphics.ReleaseHdc($hdc) }
    if (-not $printed) {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
    }
    $bmp.Save($env:AUVRYNT_CAPTURE_OUTPUT, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bmp.Dispose()
}
`;

  await mkdir(dirname(absoluteOutputPath), { recursive: true });

  try {
    await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
      env: {
        ...process.env,
        AUVRYNT_CAPTURE_PID: pid ? String(pid) : "",
        AUVRYNT_CAPTURE_TITLE: title ?? "",
        AUVRYNT_CAPTURE_OUTPUT: absoluteOutputPath,
      },
      maxBuffer: 1024 * 1024,
      timeout: 20_000,
      windowsHide: true,
    });
    const buffer = await readFile(absoluteOutputPath);
    const relPath = relative(workspace.root, absoluteOutputPath).replace(/\\/g, "/");

    return {
      content: [
        ...inlineImageOrNotice(buffer, `Window capture ${relPath}`, "image/png"),
        { type: "text", text: `Captured target window screenshot to ${relPath}` },
      ],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Window capture failed: ${msg}` }],
      isError: true,
    };
  }
}
