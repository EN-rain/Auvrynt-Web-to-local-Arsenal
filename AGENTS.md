# Auvrynt

This project exposes a local development workspace over MCP so ChatGPT, Claude, Grok,
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
- [ASEPRITE_AGENT_GUIDE.md](guides/ASEPRITE_AGENT_GUIDE.md) — pixel art and 2D sprite animation

Serena is a local semantic code engine available through Auvrynt. When Serena is enabled (`AUVRYNT_SERENA_ENABLED=true`), call `serena_start_session` after `open_workspace` to activate semantic tools. Use `serena_find_symbol`, `serena_find_referencing_symbols`, and other `serena_*` tools for code navigation. See the routing rules in [PROJECT_ROUTER.md](guides/PROJECT_ROUTER.md) and each guide for when to use Serena vs Auvrynt native tools.

Before development work:
1. Detect the active project or subproject using root indicators.
2. Read [PROJECT_ROUTER.md](guides/PROJECT_ROUTER.md).
3. Load only the relevant guide. Do not load all guides by default.
4. Use only tools relevant to the current task.
5. Never invent unavailable tools or unverified results.

## Mandatory Progress Log

Every agent MUST maintain a `progress.md` file in the root of the specific
project/workspace it is working on. Do not automatically use the Auvrynt
repository root when the requested project is a subdirectory.

Strict rules:

1. First identify the requested project/workspace directory. Check whether
   `<project-directory>\progress.md` exists. If it does not exist, create it
   there before making any other edit, then append a timestamped start entry.
2. Before every mutating action, append an intent entry. After the action
   completes or fails, append a result entry. This protects the audit trail if
   a command fails or the agent is interrupted.
3. Log every file edit, creation, deletion, build, test, commit, install,
   restart, publish attempt, or other repository/system-changing action.
4. Every entry MUST include the local ISO-8601 timestamp, the agent identity,
   the action, the exact files or command affected, the reason, and the result
   or blocker.
5. `progress.md` is append-only. Never rewrite, truncate, reorder, or delete
   previous entries, even if they are incorrect or belong to another agent.
   Appending the required log entry to `progress.md` itself is the only
   exception and does not require a second recursive entry.
6. Record failed commands, partial changes, and external side effects; do not
   log only successful work.
7. If a task spans multiple projects, use a separate `progress.md` in each
   affected project directory and log each project's changes there.
8. Serialize concurrent appends: reread the file immediately before writing,
   append to the latest content, and never overwrite another agent's entry.
9. Do not put passwords, access tokens, OAuth tokens, or other secrets in the
   log. Redact them as `[REDACTED]`.
10. Before handing off or finishing, append a final status entry listing the
    verification performed and any remaining work.

Minimum entry format:

```text
## 2026-08-01T00:00:00+08:00 — Agent
- Action: Updated `src/example.ts`
- Files: `src/example.ts`
- Reason: Implemented the requested behavior.
- Result: Typecheck passed. Remaining: none.
```

## Troubleshooting

### HTTP 502 from Playwright / browser-tools backend
If the server returns 502 after a Playwright run, the Node.js process may have
crashed or the connector may have rejected an oversized/idle response. Auvrynt
now bounds inline payloads, sends SSE heartbeats, force-cleans stuck Chromium,
and schedules bounded managed-process recovery for fatal errors. To diagnose:
1. Check console output for `[auvrynt] Unhandled rejection` or `[auvrynt] FATAL` messages.
2. Check `~/.auvrynt/logs/` for event logs.
3. Restart the server (`auvrynt start` or relaunch the CLI).
