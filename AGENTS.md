# Auvrynt

This project exposes a local development workspace over MCP so ChatGPT, Claude,
or another MCP-capable host can operate directly on this machine's approved
development directories.

The model-facing workflow is workspace based. MCP clients should call
`open_workspace` once per local project directory or worktree, then reuse the
returned `workspaceId` for subsequent tool calls.

Project-specific development instructions:
- [PROJECT_ROUTER.md](guides/PROJECT_ROUTER.md) — read first
- [WEB_AGENT_GUIDE.md](guides/WEB_AGENT_GUIDE.md) — web projects
- [SOFTWARE_AGENT_GUIDE.md](guides/SOFTWARE_AGENT_GUIDE.md) — .NET/general software
- [GODOT_AGENT_GUIDE.md](guides/GODOT_AGENT_GUIDE.md) — Godot projects
- [BLENDER_AGENT_GUIDE.md](guides/BLENDER_AGENT_GUIDE.md) — Blender 3D

Serena is a local semantic code engine available through Auvrynt. When Serena is enabled (`AUVRYNT_SERENA_ENABLED=true`), call `serena_start_session` after `open_workspace` to activate semantic tools. Use `serena_find_symbol`, `serena_find_referencing_symbols`, and other `serena_*` tools for code navigation. See the routing rules in [PROJECT_ROUTER.md](guides/PROJECT_ROUTER.md) and each guide for when to use Serena vs Auvrynt native tools.

Before development work:
1. Detect the active project or subproject using root indicators.
2. Read [PROJECT_ROUTER.md](guides/PROJECT_ROUTER.md).
3. Load only the relevant guide. Do not load all guides by default.
4. Use only tools relevant to the current task.
5. Never invent unavailable tools or unverified results.
