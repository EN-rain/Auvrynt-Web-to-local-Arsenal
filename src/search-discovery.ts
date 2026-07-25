import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { WorkspaceRegistry, Workspace } from "./workspaces.js";

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  ".auvrynt-run",
  "node_modules",
  "dist",
  "build",
  "bin",
  "obj",
  ".next",
  ".godot",
  "__pycache__",
]);

export interface GlobFilesInput {
  workspaceId: string;
  pattern: string;
  basePath?: string;
  maxResults?: number;
}

export interface SearchTextInput {
  workspaceId: string;
  query: string;
  paths?: string[];
  filePattern?: string;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface SearchTextMatch {
  path: string;
  line: number;
  column: number;
  match: string;
  context: string[];
}

export interface InspectProjectInput {
  workspaceId: string;
  path?: string;
}

export interface ProjectSummary {
  workspaceId: string;
  root: string;
  projectTypes: string[];
  packageManagers: string[];
  frameworks: string[];
  configFiles: string[];
  recommendedCommands: {
    build?: string;
    run?: string;
    test?: string;
    lint?: string;
    format?: string;
  };
  details: Record<string, unknown>;
}

export async function globFiles(
  registry: WorkspaceRegistry,
  input: GlobFilesInput,
): Promise<{ files: string[]; total: number; truncated: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const baseDir = input.basePath
    ? registry.resolvePath(workspace, input.basePath)
    : workspace.root;

  const maxResults = Math.min(Math.max(input.maxResults ?? 100, 1), 1000);
  const matchedFiles: string[] = [];
  let truncated = false;

  // Convert glob pattern to simple Regex
  const regexPattern = input.pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/\?/g, ".");
  const patternRegex = new RegExp(`^${regexPattern}$`, "i");

  async function walk(dir: string) {
    if (matchedFiles.length >= maxResults) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matchedFiles.length >= maxResults) {
        truncated = true;
        return;
      }

      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(workspace.root, fullPath).replace(/\\/g, "/");

        if (patternRegex.test(entry.name) || patternRegex.test(relPath)) {
          matchedFiles.push(relPath);
        }
      }
    }
  }

  await walk(baseDir);

  return {
    files: matchedFiles,
    total: matchedFiles.length,
    truncated,
  };
}

export async function searchText(
  registry: WorkspaceRegistry,
  input: SearchTextInput,
): Promise<{ matches: SearchTextMatch[]; total: number; truncated: boolean }> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const searchRoot = workspace.root;

  const maxResults = Math.min(Math.max(input.maxResults ?? 50, 1), 500);
  const caseSensitive = input.caseSensitive ?? false;
  const flags = caseSensitive ? "g" : "gi";
  const searchRegex = new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);

  const fileFilterRegex = input.filePattern
    ? new RegExp(
        input.filePattern
          .replace(/\./g, "\\.")
          .replace(/\*/g, ".*"),
        "i",
      )
    : null;

  const matches: SearchTextMatch[] = [];
  let truncated = false;

  async function searchInFile(fullPath: string) {
    if (matches.length >= maxResults) {
      truncated = true;
      return;
    }

    let text: string;
    try {
      const stats = await stat(fullPath);
      // Skip binary/huge files > 2 MB
      if (stats.size > 2 * 1024 * 1024) return;
      text = await readFile(fullPath, "utf8");
    } catch {
      return;
    }

    const lines = text.split(/\r?\n/);
    const relPath = relative(workspace.root, fullPath).replace(/\\/g, "/");

    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }

      const lineText = lines[i];
      searchRegex.lastIndex = 0;
      const matchExec = searchRegex.exec(lineText);
      if (matchExec) {
        const startCtx = Math.max(0, i - 1);
        const endCtx = Math.min(lines.length - 1, i + 1);
        const context = lines.slice(startCtx, endCtx + 1);

        matches.push({
          path: relPath,
          line: i + 1,
          column: matchExec.index + 1,
          match: lineText.trim(),
          context,
        });
      }
    }
  }

  async function walk(dir: string) {
    if (matches.length >= maxResults) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }

      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        if (fileFilterRegex && !fileFilterRegex.test(entry.name)) continue;
        await searchInFile(join(dir, entry.name));
      }
    }
  }

  const targetDirs = input.paths?.length
    ? input.paths.map((p) => registry.resolvePath(workspace, p))
    : [searchRoot];

  for (const dir of targetDirs) {
    const s = await stat(dir).catch(() => null);
    if (s?.isDirectory()) {
      await walk(dir);
    } else if (s?.isFile()) {
      await searchInFile(dir);
    }
  }

  return {
    matches,
    total: matches.length,
    truncated,
  };
}

export async function inspectProject(
  registry: WorkspaceRegistry,
  input: InspectProjectInput,
): Promise<ProjectSummary> {
  const workspace = registry.getWorkspace(input.workspaceId);
  const targetDir = input.path
    ? registry.resolvePath(workspace, input.path)
    : workspace.root;

  const projectTypes: string[] = [];
  const packageManagers: string[] = [];
  const frameworks: string[] = [];
  const configFiles: string[] = [];
  const recommendedCommands: ProjectSummary["recommendedCommands"] = {};
  const details: Record<string, unknown> = {};

  let entries: string[] = [];
  try {
    entries = await readdir(targetDir);
  } catch {}

  const entrySet = new Set(entries);

  // Check Node.js / TypeScript
  if (entrySet.has("package.json")) {
    projectTypes.push("nodejs");
    configFiles.push("package.json");
    try {
      const pkgContent = await readFile(join(targetDir, "package.json"), "utf8");
      const pkgJson = JSON.parse(pkgContent);
      details.packageName = pkgJson.name;
      details.scripts = pkgJson.scripts ?? {};

      if (pkgJson.scripts?.build) recommendedCommands.build = "npm run build";
      if (pkgJson.scripts?.dev) recommendedCommands.run = "npm run dev";
      else if (pkgJson.scripts?.start) recommendedCommands.run = "npm start";
      if (pkgJson.scripts?.test) recommendedCommands.test = "npm test";
      if (pkgJson.scripts?.lint) recommendedCommands.lint = "npm run lint";

      const allDeps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
      if (allDeps.next) frameworks.push("nextjs");
      if (allDeps.vite) frameworks.push("vite");
      if (allDeps.react) frameworks.push("react");
      if (allDeps.express) frameworks.push("express");
    } catch {}
  }

  if (entrySet.has("package-lock.json")) packageManagers.push("npm");
  if (entrySet.has("pnpm-lock.yaml")) packageManagers.push("pnpm");
  if (entrySet.has("yarn.lock")) packageManagers.push("yarn");
  if (entrySet.has("bun.lockb") || entrySet.has("bun.lock")) packageManagers.push("bun");

  if (entrySet.has("tsconfig.json")) {
    projectTypes.push("typescript");
    configFiles.push("tsconfig.json");
  }

  // Check .NET
  const dotnetFiles = entries.filter((e) => e.endsWith(".csproj") || e.endsWith(".fsproj") || e.endsWith(".sln"));
  if (dotnetFiles.length > 0) {
    projectTypes.push("dotnet");
    configFiles.push(...dotnetFiles);
    recommendedCommands.build = recommendedCommands.build ?? "dotnet build";
    recommendedCommands.run = recommendedCommands.run ?? "dotnet run";
    recommendedCommands.test = recommendedCommands.test ?? "dotnet test";
    recommendedCommands.format = recommendedCommands.format ?? "dotnet format";
    details.dotnetFiles = dotnetFiles;
  }

  // Check Godot
  if (entrySet.has("project.godot")) {
    projectTypes.push("godot");
    configFiles.push("project.godot");
    recommendedCommands.run = recommendedCommands.run ?? "godot --path .";
    details.godotProject = true;
  }

  // Check Python
  if (entrySet.has("pyproject.toml") || entrySet.has("requirements.txt") || entrySet.has("setup.py")) {
    projectTypes.push("python");
    if (entrySet.has("pyproject.toml")) configFiles.push("pyproject.toml");
    if (entrySet.has("requirements.txt")) configFiles.push("requirements.txt");
    recommendedCommands.run = recommendedCommands.run ?? "python main.py";
  }

  // Check Git
  if (entrySet.has(".git")) {
    configFiles.push(".git");
    details.gitRepository = true;
  }

  return {
    workspaceId: input.workspaceId,
    root: targetDir,
    projectTypes,
    packageManagers,
    frameworks,
    configFiles,
    recommendedCommands,
    details,
  };
}
