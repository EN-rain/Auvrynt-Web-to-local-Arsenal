import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceRegistry } from "./workspaces.js";
import type { ProcessManager } from "./processes.js";
import type { ToolResponse } from "./pi-tools.js";

const execFileAsync = promisify(execFile);

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
  const absoluteOutputPath = registry.resolvePath(workspace, input.outputPath);

  if (process.platform !== "win32") {
    return {
      content: [
        {
          type: "text",
          text: `Window capture is currently supported on Windows hosts. Operating system "${process.platform}" is not supported.`,
        },
      ],
      isError: true,
    };
  }

  let pid: number | undefined;
  if (input.processId) {
    const tracked = processManager.getTrackedProcess(input.workspaceId, input.processId);
    pid = tracked.pid;
  }

  const psScript = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$handle = [IntPtr]::Zero
${pid ? `$proc = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($proc) { $handle = $proc.MainWindowHandle }` : ""}
${input.windowTitle ? `if ($handle -eq [IntPtr]::Zero) { $proc = Get-Process | Where-Object { $_.MainWindowTitle -like "*${input.windowTitle}*" } | Select-Object -First 1; if ($proc) { $handle = $proc.MainWindowHandle } }` : ""}

if ($handle -eq [IntPtr]::Zero) {
    [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save('${absoluteOutputPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
} else {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bmp)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save('${absoluteOutputPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
}
`;

  await mkdir(dirname(absoluteOutputPath), { recursive: true });

  try {
    await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psScript]);
    const buffer = await readFile(absoluteOutputPath);
    const relPath = relative(workspace.root, absoluteOutputPath).replace(/\\/g, "/");

    return {
      content: [
        {
          type: "image",
          data: buffer.toString("base64"),
          mimeType: "image/png",
        },
        {
          type: "text",
          text: `Captured window screenshot saved to ${relPath}`,
        },
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
