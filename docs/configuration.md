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
| `AUVRYNT_PUBLIC_BASE_URL` | Public origin used by foreground `auvrynt serve`, without `/mcp`. Non-loopback origins must use HTTPS. Managed `auvrynt start` supplies its tunnel URL automatically. |
| `AUVRYNT_TUNNEL_PROVIDER` | Managed background tunnel: `cloudflare` (default) or `ngrok`. The same managed tunnel is retained across profile changes and soft restarts. |
| `AUVRYNT_NGROK_AUTHTOKEN` | Optional ngrok token when ngrok is not already authenticated locally. |
| `AUVRYNT_NGROK_URL` | Optional stable HTTPS origin reserved on the ngrok account, such as `https://your-name.ngrok.app`. Auvrynt passes it through ngrok's `--url` option. |
| `AUVRYNT_ALLOWED_HOSTS` | Optional Host header allowlist override. |
| `AUVRYNT_OAUTH_OWNER_TOKEN` | Owner token for OAuth approval. Must be at least 16 characters. |
| `AUVRYNT_WORKTREE_ROOT` | Directory for managed Git worktrees. Defaults to `~/.auvrynt/worktrees`. |
| `AUVRYNT_STATE_DIR` | Directory for SQLite state. Defaults to `~/.local/share/auvrynt`. |
| `AUVRYNT_SESSION_IDLE_MS` | MCP session inactivity before disconnect. Defaults to 24 hours. |
| `AUVRYNT_DISCONNECT_GRACE_MS` | Time a disconnected MCP session is retained for reconnect. Defaults to 12 hours. |

## OAuth

Auvrynt uses a single-user OAuth approval flow.

| Variable | Default |
| --- | --- |
| `AUVRYNT_OAUTH_ACCESS_TOKEN_TTL_SECONDS` | `3600` |
| `AUVRYNT_OAUTH_REFRESH_TOKEN_TTL_SECONDS` | `2592000` |
| `AUVRYNT_OAUTH_SCOPES` | `auvrynt:read,auvrynt:write,auvrynt:process,auvrynt:web,auvrynt:software,auvrynt:godot,auvrynt:blender,auvrynt:serena` |
| `AUVRYNT_OAUTH_ALLOWED_REDIRECT_HOSTS` | `chatgpt.com,claude.ai,claude.com,localhost,127.0.0.1` |

`auvrynt:blender-python` is intentionally **not** granted by default. Add it to `AUVRYNT_OAUTH_SCOPES` only when a trusted client must use the arbitrary Blender Python escape hatch. Auvrynt enforces scopes per tool call, not only at login.

OAuth scopes are the durable capability envelope; integration profiles are a second local execution gate. Changing profiles updates that local gate without closing MCP sessions or changing the public tunnel URL. When the owner explicitly enables a profile, existing tokens receive only the required scopes that are already allowed by `AUVRYNT_OAUTH_SCOPES`.

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

Plain HTTP public origins are rejected unless the hostname is loopback (`localhost`, `127.0.0.0/8`, or `::1`). Use HTTPS for every tunnel, reverse proxy, LAN hostname, and public deployment.

Run `auvrynt tunnel` to switch the managed provider interactively. With ngrok, leaving the stable URL blank uses an assigned URL; supplying `AUVRYNT_NGROK_URL` or saving the same value through the tunnel command keeps that origin across hard restarts as long as the reservation remains available. Auvrynt discovers the active ngrok URL from that process's structured startup logs rather than querying the shared `127.0.0.1:4040` inspector API, so another local ngrok process cannot be mistaken for Auvrynt's tunnel.

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
