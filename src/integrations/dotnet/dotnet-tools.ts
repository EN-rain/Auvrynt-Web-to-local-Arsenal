import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import type { WorkspaceRegistry } from "../../workspaces.js";
import type { ProcessManager } from "../../processes.js";

const execFileAsync = promisify(execFile);

export interface InspectDotnetProjectInput {
  workspaceId: string;
  projectPath: string;
}

export interface DotnetRestoreInput {
  workspaceId: string;
  projectPath: string;
}

export interface DotnetBuildInput {
  workspaceId: string;
  projectPath: string;
  configuration?: "Debug" | "Release";
  noRestore?: boolean;
}

export interface DotnetTestInput {
  workspaceId: string;
  projectPath: string;
  configuration?: "Debug" | "Release";
  filter?: string;
  noBuild?: boolean;
}

export interface DotnetRunInput {
  workspaceId: string;
  projectPath: string;
  configuration?: "Debug" | "Release";
  arguments?: string[];
  environment?: Record<string, string>;
}

export interface DotnetFormatInput {
  workspaceId: string;
  projectPath: string;
  verifyOnly?: boolean;
}

export interface DotnetDiagnostic {
  code?: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
}

export function parseDotnetBuildOutput(output: string): {
  success: boolean;
  errors: DotnetDiagnostic[];
  warnings: DotnetDiagnostic[];
} {
  const errors: DotnetDiagnostic[] = [];
  const warnings: DotnetDiagnostic[] = [];
  const lines = output.split(/\r?\n/);
  const diagRegex = /^(.*?)\((\d+),(\d+)\):\s*(error|warning)\s*([A-Z0-9]+)?:\s*(.*?)(?:\[.*\])?$/;

  for (const line of lines) {
    const match = line.trim().match(diagRegex);
    if (match) {
      const [, filePath, lineNum, colNum, severity, code, message] = match;
      const diag: DotnetDiagnostic = {
        path: filePath,
        line: Number(lineNum),
        column: Number(colNum),
        code: code ?? undefined,
        message: message.trim(),
      };
      if (severity.toLowerCase() === "error") errors.push(diag);
      else warnings.push(diag);
    }
  }

  const success = errors.length === 0 && !output.includes("Build FAILED");
  return { success, errors, warnings };
}

export function parseDotnetTestOutput(output: string): {
  passed: number;
  failed: number;
  skipped: number;
  failedTestNames: string[];
  assertionMessages: string[];
} {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failedTestNames: string[] = [];
  const assertionMessages: string[] = [];

  const summaryMatch = output.match(/Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+)/i);
  if (summaryMatch) {
    failed = Number(summaryMatch[1]);
    passed = Number(summaryMatch[2]);
    skipped = Number(summaryMatch[3]);
  }

  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes("Failed ") || line.includes("Failed:")) {
      const nameMatch = line.match(/Failed\s+([A-Za-z0-9_.]+)/);
      if (nameMatch && !failedTestNames.includes(nameMatch[1])) failedTestNames.push(nameMatch[1]);
    }
    if (line.includes("Assert.") || line.includes("Expected:") || line.includes("Actual:")) {
      assertionMessages.push(line.trim());
    }
  }

  return { passed, failed, skipped, failedTestNames, assertionMessages };
}

export async function inspectDotnetProject(
  registry: WorkspaceRegistry,
  input: InspectDotnetProjectInput,
): Promise<{
  projectPath: string;
  sdkStyle: boolean;
  targetFrameworks: string[];
  outputType: string;
  nullable: string;
  implicitUsings: string;
  packageReferences: string[];
  projectReferences: string[];
  testFramework?: string;
}> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.projectPath);

  let xmlContent = "";
  try {
    xmlContent = await readFile(absolutePath, "utf8");
  } catch {
    throw new Error(`Unable to read .NET project file: ${input.projectPath}`);
  }

  const sdkStyle = xmlContent.includes('<Project Sdk=') || xmlContent.includes('Sdk="Microsoft.NET.Sdk');
  const tfmMatch = xmlContent.match(/<TargetFrameworks?>(.*?)<\/TargetFrameworks?>/i);
  const targetFrameworks = tfmMatch ? tfmMatch[1].split(";").map((t) => t.trim()) : [];
  const outputTypeMatch = xmlContent.match(/<OutputType>(.*?)<\/OutputType>/i);
  const outputType = outputTypeMatch ? outputTypeMatch[1].trim() : "Exe";
  const nullableMatch = xmlContent.match(/<Nullable>(.*?)<\/Nullable>/i);
  const nullable = nullableMatch ? nullableMatch[1].trim() : "enable";
  const implicitUsingsMatch = xmlContent.match(/<ImplicitUsings>(.*?)<\/ImplicitUsings>/i);
  const implicitUsings = implicitUsingsMatch ? implicitUsingsMatch[1].trim() : "enable";

  const packageReferences: string[] = [];
  const pkgRegex = /<PackageReference\s+Include="([^"]+)"/g;
  let pkgMatch;
  while ((pkgMatch = pkgRegex.exec(xmlContent)) !== null) packageReferences.push(pkgMatch[1]);

  const projectReferences: string[] = [];
  const projRefRegex = /<ProjectReference\s+Include="([^"]+)"/g;
  let projRefMatch;
  while ((projRefMatch = projRefRegex.exec(xmlContent)) !== null) projectReferences.push(projRefMatch[1]);

  let testFramework: string | undefined;
  if (packageReferences.some((p) => p.includes("xunit"))) testFramework = "xUnit";
  else if (packageReferences.some((p) => p.includes("nunit"))) testFramework = "NUnit";
  else if (packageReferences.some((p) => p.includes("MSTest"))) testFramework = "MSTest";

  return {
    projectPath: input.projectPath,
    sdkStyle,
    targetFrameworks,
    outputType,
    nullable,
    implicitUsings,
    packageReferences,
    projectReferences,
    testFramework,
  };
}

export async function dotnetRestore(
  registry: WorkspaceRegistry,
  input: DotnetRestoreInput,
): Promise<{ success: boolean; durationMs: number; output: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.projectPath);
  const cwd = dirname(absolutePath);
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("dotnet", ["restore", absolutePath], { cwd });
    return { success: true, durationMs: Date.now() - start, output: (stdout + "\n" + stderr).slice(0, 1000) };
  } catch (err: any) {
    return {
      success: false,
      durationMs: Date.now() - start,
      output: (err.stdout ?? "") + "\n" + (err.stderr ?? err.message),
    };
  }
}

export async function dotnetBuild(
  registry: WorkspaceRegistry,
  input: DotnetBuildInput,
): Promise<{
  success: boolean;
  durationMs: number;
  errors: DotnetDiagnostic[];
  warnings: DotnetDiagnostic[];
}> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.projectPath);
  const cwd = dirname(absolutePath);
  const args = ["build", absolutePath];
  if (input.configuration) args.push("-c", input.configuration);
  if (input.noRestore) args.push("--no-restore");

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("dotnet", args, { cwd });
    const parsed = parseDotnetBuildOutput(stdout + "\n" + stderr);
    return { success: parsed.success, durationMs: Date.now() - start, errors: parsed.errors, warnings: parsed.warnings };
  } catch (err: any) {
    const parsed = parseDotnetBuildOutput((err.stdout ?? "") + "\n" + (err.stderr ?? err.message));
    return {
      success: false,
      durationMs: Date.now() - start,
      errors: parsed.errors.length > 0 ? parsed.errors : [{ message: err.message }],
      warnings: parsed.warnings,
    };
  }
}

export async function dotnetTest(
  registry: WorkspaceRegistry,
  input: DotnetTestInput,
): Promise<{
  passed: number;
  failed: number;
  skipped: number;
  failedTestNames: string[];
  assertionMessages: string[];
  durationMs: number;
}> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.projectPath);
  const cwd = dirname(absolutePath);
  const args = ["test", absolutePath];
  if (input.configuration) args.push("-c", input.configuration);
  if (input.filter) args.push("--filter", input.filter);
  if (input.noBuild) args.push("--no-build");

  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("dotnet", args, { cwd });
    return { ...parseDotnetTestOutput(stdout + "\n" + stderr), durationMs: Date.now() - start };
  } catch (err: any) {
    return {
      ...parseDotnetTestOutput((err.stdout ?? "") + "\n" + (err.stderr ?? err.message)),
      durationMs: Date.now() - start,
    };
  }
}

export async function dotnetRun(
  registry: WorkspaceRegistry,
  processManager: ProcessManager,
  input: DotnetRunInput,
): Promise<{ processId: string; status: string; detectedUrls: string[] }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.projectPath);
  const configArg = input.configuration ? `-c ${input.configuration}` : "";
  const extraArgs = input.arguments?.length ? `-- ${input.arguments.join(" ")}` : "";
  const command = `dotnet run --project "${absolutePath}" ${configArg} ${extraArgs}`.trim();
  const result = processManager.startProcess({
    workspaceId: input.workspaceId,
    command,
    environment: input.environment,
  });
  return { processId: result.processId, status: result.status, detectedUrls: result.detectedUrls };
}

export async function dotnetFormat(
  registry: WorkspaceRegistry,
  input: DotnetFormatInput,
): Promise<{ success: boolean; output: string }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const absolutePath = registry.resolvePath(workspace, input.projectPath);
  const args = ["format", absolutePath];
  if (input.verifyOnly) args.push("--verify-no-changes");

  try {
    const { stdout, stderr } = await execFileAsync("dotnet", args, { cwd: dirname(absolutePath) });
    return { success: true, output: (stdout + "\n" + stderr).slice(0, 1000) };
  } catch (err: any) {
    return { success: false, output: (err.stdout ?? "") + "\n" + (err.stderr ?? err.message) };
  }
}
