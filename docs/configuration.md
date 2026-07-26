# Configuration Reference

Auvrynt can be configured through `auvrynt init`, persisted config files, or
environment variables.

The default files are:

```text
~/.auvrynt/config.json
~/.auvrynt/auth.json
```

Use another config directory with:

```bash
AUVRYNT_CONFIG_DIR=/path/to/config npx auvrynt start
```

## Commands

```bash
npx auvrynt init
npx auvrynt start
npx auvrynt doctor
npx auvrynt config get
npx auvrynt config set publicBaseUrl https://auvrynt.example.com
```

## Core Environment Variables

| Variable | Purpose |
| --- | --- |
| `HOST` | Local bind host. Defaults to `127.0.0.1`. |
| `PORT` | Local port. Defaults to `49321`. |
| `AUVRYNT_ALLOWED_ROOTS` | Comma-separated local roots that workspaces may open. |
| `AUVRYNT_PUBLIC_BASE_URL` | Public origin for the server, without `/mcp`. |
| `AUVRYNT_ALLOWED_HOSTS` | Optional Host header allowlist override. |
| `AUVRYNT_OAUTH_OWNER_TOKEN` | Owner token for OAuth approval. Must be at least 16 characters. |
| `AUVRYNT_WORKTREE_ROOT` | Directory for managed Git worktrees. Defaults to `~/.auvrynt/worktrees`. |
| `AUVRYNT_STATE_DIR` | Directory for SQLite state. Defaults to `~/.local/share/auvrynt`. |

## OAuth

Auvrynt uses a single-user OAuth approval flow.

| Variable | Default |
| --- | --- |
| `AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS` | `3600` |
| `AUVRYNT_OAUTH_REFRESH_TOKEN_TTL_SECONDS` | `2592000` |
| `AUVRYNT_OAUTH_SCOPES` | `auvrynt:read,auvrynt:write,auvrynt:process,auvrynt:web,auvrynt:software,auvrynt:godot,auvrynt:blender,auvrynt:serena` |
| `AUVRYNT_OAUTH_ALLOWED_REDIRECT_HOSTS` | `chatgpt.com,claude.ai,claude.com,localhost,127.0.0.1` |

`auvrynt:blender-python` is intentionally **not** granted by default. Add it to `AUVRYNT_OAUTH_SCOPES` only when a trusted client must use the arbitrary Blender Python escape hatch. Auvrynt enforces scopes per tool call, not only at login.

MCP clients discover metadata from:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
```

## Tool Modes

`AUVRYNT_TOOL_NAMING` controls tool names.

| Value | Behavior |
| --- | --- |
| `short` | Default. Uses `read`, `edit`, `bash`, and related names. |
| `legacy` | Uses `read_file`, `edit_file`, `run_shell`, and related names. |

`AUVRYNT_TOOL_MODE` controls the tool surface.

| Value | Behavior |
| --- | --- |
| `minimal` | Default. Disables dedicated search and list tools. Clients use the shell tool with `rg`, `grep`, `find`, `ls`, or `tree` for inspection. |
| `full` | Enables dedicated `grep`, `glob`, and `ls` tools. |

## Widgets

`AUVRYNT_WIDGETS` controls ChatGPT Apps iframe usage.

| Value | Behavior |
| --- | --- |
| `full` | Default. Widget UI is attached to exposed workspace, file, edit, and shell tools. |
| `changes` | Enables the aggregate `show_changes` tool and attaches widget UI to `open_workspace` and `show_changes`. |
| `off` | Disables widget UI. |

## Skills

| Variable | Purpose |
| --- | --- |
| `AUVRYNT_SKILLS` | Set to `0` to hide skills. Enabled by default. |
| `AUVRYNT_AGENT_DIR` | Defaults to `~/.codex`. |
| `AUVRYNT_SKILL_PATHS` | Optional comma-separated skill directories. |

Example:

```bash
AUVRYNT_SKILL_PATHS="$HOME/.codex/skills,$HOME/.claude/skills" \
npx auvrynt start
```

## Logging

| Variable | Default |
| --- | --- |
| `AUVRYNT_LOG_LEVEL` | `info` |
| `AUVRYNT_LOG_FORMAT` | `json` |
| `AUVRYNT_LOG_REQUESTS` | `1` |
| `AUVRYNT_LOG_ASSETS` | `0` |
| `AUVRYNT_LOG_TOOL_CALLS` | `1` |
| `AUVRYNT_LOG_SHELL_COMMANDS` | `0` |

Auvrynt trusts forwarded client information only from an immediate loopback proxy. This is fixed behavior rather than a runtime toggle so direct remote clients cannot opt into spoofable forwarding headers.

Set `AUVRYNT_LOG_FORMAT=pretty` for local debugging.

Set `AUVRYNT_LOG_SHELL_COMMANDS=1` only when you intentionally want command
previews in logs.

## Env-Only Example

```bash
AUVRYNT_OAUTH_OWNER_TOKEN="$(openssl rand -base64 32)" \
AUVRYNT_ALLOWED_ROOTS="$HOME/personal,$HOME/work" \
AUVRYNT_PUBLIC_BASE_URL="https://auvrynt.example.com" \
AUVRYNT_WORKTREE_ROOT="$HOME/.auvrynt/worktrees" \
AUVRYNT_TOOL_MODE="minimal" \
AUVRYNT_TOOL_NAMING="short" \
AUVRYNT_WIDGETS="full" \
npx auvrynt start
```

The environment assignments must be part of the same command invocation, or
exported first.
