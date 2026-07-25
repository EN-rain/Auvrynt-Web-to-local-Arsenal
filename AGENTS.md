# Auvrynt

This project exposes a local development workspace over MCP so ChatGPT, Claude,
or another MCP-capable host can operate directly on this machine's approved
development directories.

The model-facing workflow is workspace based. MCP clients should call
`open_workspace` once per local project directory or worktree, then reuse the
returned `workspaceId` for subsequent tool calls.

Project-specific development instructions:
- [PROJECT_ROUTER.md](guides/PROJECT_ROUTER.md)
- [WEB_AGENT_GUIDE.md](guides/WEB_AGENT_GUIDE.md)
- [SOFTWARE_AGENT_GUIDE.md](guides/SOFTWARE_AGENT_GUIDE.md)
- [GODOT_AGENT_GUIDE.md](guides/GODOT_AGENT_GUIDE.md)
- [BLENDER_AGENT_GUIDE.md](guides/BLENDER_AGENT_GUIDE.md)

Before development work:
1. Detect the active project or subproject using root indicators.
2. Read [PROJECT_ROUTER.md](guides/PROJECT_ROUTER.md).
3. Load only the relevant guide. Do not load all guides by default.
4. Use only tools relevant to the current task.
5. Never invent unavailable tools or unverified results.
