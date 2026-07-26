

<p align="center">
  <img src="docs/assets/auvrynt-icon.png" alt="Auvrynt icon" width="112" height="112" />
</p>

<h1 align="center">Auvrynt — Web-to-local Arsenal</h1>

<p align="center">
  A self-hosted MCP server that gives AI coding assistants secure, real-time access to your local machine.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/auvrynt">
    <img alt="npm" src="https://img.shields.io/npm/v/auvrynt?style=flat-square&color=cb3837" />
  </a>
  <a href="https://github.com/EN-rain/Auvrynt-Web-to-local-Arsenal/actions/workflows/ci.yml">
    <img alt="CI" src="https://img.shields.io/github/actions/workflow/status/EN-rain/Auvrynt-Web-to-local-Arsenal/ci.yml?style=flat-square&branch=main" />
  </a>
  <a href="https://github.com/EN-rain/Auvrynt-Web-to-local-Arsenal/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/npm/l/auvrynt?style=flat-square" />
  </a>
  <a href="https://nodejs.org">
    <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20.12-brightgreen?style=flat-square" />
  </a>
</p>

---

## What is Auvrynt?

Auvrynt is a **Model Context Protocol (MCP) server** you run on your own machine. It creates a secure, tunneled connection between AI clients like ChatGPT or Claude and your local development environment — your actual files, terminals, build tools, and project folders.

No cloud upload. No third-party storage. Your code stays on your machine.

Connect once, then ask your AI to:

- Open any approved project folder on your machine
- Read, write, search, and edit real source files
- Run shell commands, tests, builds, and package scripts
- Work across web, .NET, Godot, and Blender projects
- Capture screenshots of running apps
- Use isolated Git worktrees for parallel coding sessions

---

## Quick Start

> **Requires:** Node.js `>=20.12 <27` — Node 22 LTS recommended

**Install globally:**

```bash
npm install -g auvrynt
```

**Set up and start:**

```bash
auvrynt start
```

`auvrynt start` creates local configuration automatically. Use `auvrynt init`
only when you want to configure foreground `auvrynt serve` manually.

**Or run directly without installing:**

```bash
npx auvrynt init
npx auvrynt start
```

During `auvrynt init`, you will be asked for:

| Prompt | Description |
|---|---|
| Project roots | Local folder paths your AI is allowed to access |
| Local port | Default is `49321` |
| Public base URL | The tunnel URL used by foreground `auvrynt serve` |

> **Important:** Provide the base URL — do **not** include `/mcp`. Example: `https://your-tunnel.trycloudflare.com`

---

## Start the Server

```bash
# Starts one managed background instance, scoped to the current directory
auvrynt start

# Check or stop the background instance
auvrynt status
auvrynt stop

# Foreground server with verbose request logs
auvrynt serve
```

When using foreground `auvrynt serve`, the terminal shows request activity. Background `auvrynt start` returns only after the local server and tunnel are ready; use `auvrynt status` to inspect the managed PID, workspace, profiles, and public URL.

---

`auvrynt start` starts one temporary Cloudflare tunnel and one Auvrynt server in the background. It does not keep the terminal occupied. The tunnel stays alive while profiles are added or replaced, so its URL remains the same until `auvrynt stop` or the Cloudflare process itself exits. A second start asks before changing the existing instance; use `--replace` when running non-interactively.

### Start only what you need

Profiles are session-only: they override saved integration choices for the current background instance without changing your config.

```bash
# One integration
auvrynt start model      # Blender MCP port detection
auvrynt start web        # Playwright/browser tools
auvrynt start godotcs    # Godot C#
auvrynt start godotgd    # Godot GDScript
auvrynt start se         # Serena

# Multiple integrations
auvrynt start model,godotcs

# Add an integration live; neither the server nor tunnel restarts
auvrynt add web

# Replace profiles live when the workspace is unchanged
auvrynt start se --replace
```

Live profile changes wait until no MCP request is active, then refresh connected MCP sessions so clients can rediscover the tool list. They do not restart Auvrynt, Cloudflare, Blender, Godot, Serena, or tracked development processes. Starting with `--replace` from a different directory gracefully changes the managed workspace while preserving the tunnel.

`auvrynt stop` gracefully stops Auvrynt and then its Cloudflare tunnel. It does not close Blender or Godot. Lifecycle commands are serialized, so two terminals cannot create duplicate managed instances.

---

## Connect an MCP Client

Paste your `/mcp` URL into your AI client (ChatGPT, Claude, etc.):

```
https://your-tunnel.trycloudflare.com/mcp
```

When the client connects, Auvrynt opens a local approval page that requires your **Owner token**. Normal startup keeps that secret hidden; retrieve it only when needed with:

```bash
auvrynt token
```

It is stored locally in `~/.auvrynt/auth.json`. Keep it private and do not paste it into the MCP client itself.

---

## Commands

| Command | Description |
|---|---|
| `auvrynt init` | Run first-time setup or update your config |
| `auvrynt start [profiles]` | Start one managed background instance scoped to the current directory |
| `auvrynt start model,web` | Start selected profiles: `model`, `web`, `godotcs`, `godotgd`, `se` |
| `auvrynt start ... --replace` | Live-replace profiles, or switch the managed workspace without changing the tunnel |
| `auvrynt add <profiles>` | Add profiles live without restarting the server or tunnel |
| `auvrynt stop` | Stop Auvrynt and its Cloudflare tunnel |
| `auvrynt serve` | Start the server with verbose log output |
| `auvrynt doctor` | Show your config, Node version, and dependency health |
| `auvrynt status` | Show local MCP and integration status without modifying integration files |
| `auvrynt token` | Print the Owner token only on explicit local request |
| `auvrynt connected` | Show recently observed ChatGPT, Kimi, Claude, or other MCP providers |
| `auvrynt uninstall` | Remove Auvrynt configuration after confirmation |
| `auvrynt uninstall -y` | Remove Auvrynt configuration without confirmation |
| `auvrynt help` | Print the complete command reference |
| `auvrynt config get` | Print your saved configuration |
| `auvrynt config set publicBaseUrl <url>` | Set the public URL used by foreground `auvrynt serve` |

---

## What Your AI Can Do

Once connected and a workspace is opened, your AI assistant has access to **139 tools** across:

| Category | Capabilities |
|---|---|
| **Files** | Read, write, edit, search, glob, list directory |
| **Shell** | Run commands, tests, builds, git, package scripts |
| **Processes** | Start/stop persistent processes, tail logs |
| **Web** | Launch dev servers, screenshot pages, inspect DOM |
| **Images** | Inspect, compare, sprite-sheet splitting |
| **.NET** | Inspect projects, restore, build, test, format |
| **Godot** | Run projects, inspect scenes, C# build, GDScript diagnostics |
| **Blender** | Scene audit, checkpoints, renders, export GLB |
| **Git** | Worktree management, status, diff, branch ops |

---

## Project Routing

Auvrynt automatically selects the right workflow guide based on your project type:

| Project signals | Guide loaded |
|---|---|
| `package.json` + `vite.config.ts` / web framework | Web Agent Guide |
| `App.sln` / `.csproj` without `project.godot` | Software Agent Guide |
| `project.godot` (any language) | Godot Agent Guide |
| `.blend` files | Blender Agent Guide |

See [`PROJECT_ROUTER.md`](guides/PROJECT_ROUTER.md) for full routing rules.

---

## Platform Support

**Windows only. Tested on Windows PowerShell and cmd.exe.**

**Check your environment:**

```bash
auvrynt doctor
```

---

## Configuration

Config files are stored in `~/.auvrynt/`:

```
~/.auvrynt/config.json   ← ports, roots, public URL
~/.auvrynt/auth.json     ← owner token (keep private)
```

Key environment variables:

| Variable | Description |
|---|---|
| `AUVRYNT_ALLOWED_ROOTS` | Comma-separated project root paths |
| `AUVRYNT_PUBLIC_BASE_URL` | Public origin for foreground `auvrynt serve` (no `/mcp`) |
| `AUVRYNT_OAUTH_OWNER_TOKEN` | Override the owner token directly |
| `AUVRYNT_LOG_FORMAT` | `json` (default) or `pretty` |

See [Configuration Reference](docs/configuration.md) for all options.

---

## Documentation

| Document | Description |
|---|---|
| [Setup Guide](docs/setup.md) | Step-by-step tunnel and client setup |
| [Configuration Reference](docs/configuration.md) | All env vars and config options |
| [ChatGPT Coding Workflow](docs/chatgpt-coding-workflow.md) | How to use Auvrynt day-to-day |
| [Security Model](docs/security.md) | Path isolation, auth, and threat model |
| [Troubleshooting Gotchas](docs/gotchas.md) | Common issues and fixes |

---

## Local Development

```bash
npm install --include=dev
npm run typecheck
npm test
npm run build
npm run dev
```

---

## License

MIT — © 2026 [EN-rain](https://github.com/EN-rain)
