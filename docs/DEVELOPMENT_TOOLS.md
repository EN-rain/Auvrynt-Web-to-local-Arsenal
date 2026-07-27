# Auvrynt Local Development Tools Guide

Auvrynt extends Model Context Protocol (MCP) with tools for web application development, C#/.NET software development, Godot 4 game development, image inspection/comparison, and persistent process management.

---

## Architecture & Security Boundaries

Use `get_connection_status` after `open_workspace` to automatically probe the
authenticated MCP session, Blender, Godot, Cloudflare Tunnel, Serena, browser
support, Chrome MCP registration, and tracked workspace processes. Blender
scene tools connect directly to the Blender Lab MCP endpoint shown in Blender
preferences (`localhost:9876` by default).
Godot detection distinguishes a running Godot process from a reachable Auvrynt
editor bridge (`127.0.0.1:49322`). Cloudflare Tunnel and Serena report whether
their executables are installed and whether their processes are running. A
browser marked `available` means Playwright is installed; browser sessions are
created on demand and are not persistent connections.

1. **Workspace Boundary Enforcement**: Every path input must be relative to the opened workspace root. Path traversal (`..`) or symbolic links escaping the workspace are blocked by `WorkspaceRegistry.resolvePath`.
2. **Persistent Processes**: Long-running servers, .NET applications, and Godot games run as background child processes managed by `ProcessManager`. Standard output and error streams are captured in bounded in-memory log buffers (max 1000 lines).
3. **Secret Redaction**: Environment variables containing keywords like `TOKEN`, `SECRET`, `PASSWORD`, `KEY`, or `CONNECTION_STRING` are automatically redacted in responses and log entries.
4. **Browser & Network Security**: `capture_page_screenshot` and `inspect_page` enforce strict SSRF defenses, blocking non-HTTP(S) schemes (`file:`, `data:`, `javascript:`) and cloud metadata / private network IP addresses unless targeting recognized local development hosts (`localhost`, `127.0.0.1`, `[::1]`).

---

## Tool Reference

### Phase 1: Persistent Process Management
- `start_process`: Spawns background process inside workspace. Returns `processId`.
- `get_process_logs`: Tail stdout/stderr for a process (default 100 lines, max 500 lines).
- `list_processes`: List tracked background processes for a workspace.
- `stop_process`: Gracefully stop or force-kill (`force: true`) process tree.

### Phase 2: Structured Project Discovery & Search
- `glob_files`: Fast file globbing respecting `.gitignore` and default exclusions (`.git`, `node_modules`, `dist`, `bin`, `obj`).
- `search_text`: Workspace-wide text search returning matching lines and context snippets.
- `inspect_project`: Auto-detect Node.js, TypeScript, .NET, Godot, Python, Git projects and recommended build/run/test commands.

### Phase 3: Web-Development Tools
- `start_dev_server`: Launch web dev server (auto-detects `npm run dev` script).
- `capture_page_screenshot`: Playwright browser screenshot saved inside workspace and returned as MCP image content.
- `inspect_page`: Extract structured page title, headings, buttons, links, landmarks, console errors, and failed requests.

### Phase 4: Image and Screenshot Inspection
- `inspect_image`: Inspect dimensions, format, MIME type, alpha, and color palette.
- `compare_images`: RGBA pixel-by-pixel image comparison returning match %, changed pixels, and optional diff PNG output.
- `inspect_sprite`: Analyze sprite sheet grid dimensions, cell divisibility, and frame bounds.
- `split_sprite_sheet`: Slices sprite sheet into individual frame PNGs saved inside the workspace.

### Phase 5: C# and .NET Tools
- `inspect_dotnet_project`: Parse `.csproj`, `.fsproj`, `.sln` for SDK style, frameworks, packages, and test runner.
- `dotnet_restore`: Run `dotnet restore` securely.
- `dotnet_build`: Run `dotnet build` returning structured compiler errors/warnings with line and column.
- `dotnet_test`: Run `dotnet test` returning pass/fail/skip counts, failed test names, and assertion messages.
- `dotnet_run`: Launch .NET app as persistent process.
- `dotnet_format`: Run `dotnet format` (`verifyOnly` mode supported).

### Phase 6: Godot 4 Tools
- `detect_godot_project`: Read `project.godot` for project name, main scene, renderer, autoloads, input actions.
- `godot_run`: Launch Godot game or editor as persistent process. Environment variable `GODOT_EXECUTABLE` overrides path.
- `inspect_godot_scene`: Parse `.tscn` text scene trees, node types, signals, and external resources.

### Phase 7: Window Capture
- `capture_window`: Capture screenshot of Auvrynt-tracked application window (Windows only).
- `godot_capture_game`: Wrap window capture for Godot game processes.

---

## Development Workflows

### Web Development Workflow
```text
1. open_workspace(path)
2. inspect_project(workspaceId)
3. start_dev_server(workspaceId)
4. capture_page_screenshot(workspaceId, url="http://localhost:3000", outputPath="screenshots/home.png")
5. inspect_page(workspaceId, url="http://localhost:3000")
6. stop_process(workspaceId, processId)
```

### .NET Workflow
```text
1. open_workspace(path)
2. inspect_dotnet_project(workspaceId, projectPath="MyApp.csproj")
3. dotnet_restore(workspaceId, projectPath="MyApp.csproj")
4. dotnet_build(workspaceId, projectPath="MyApp.csproj")
5. dotnet_test(workspaceId, projectPath="MyApp.Tests.csproj")
6. dotnet_run(workspaceId, projectPath="MyApp.csproj")
```

### Godot 4 Workflow
```text
1. open_workspace(path)
2. detect_godot_project(workspaceId)
3. inspect_godot_scene(workspaceId, scenePath="scenes/main.tscn")
4. godot_run(workspaceId, projectPath=".")
5. godot_capture_game(workspaceId, processId, outputPath="captures/game.png")
6. stop_process(workspaceId, processId)
```
