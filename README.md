

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
auvrynt init
auvrynt start
```

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
| Public base URL | Your tunnel URL (Cloudflare, ngrok, Pinggy, Tailscale, etc.) |

> **Important:** Provide the base URL — do **not** include `/mcp`. Example: `https://your-tunnel.trycloudflare.com`

---

## Start the Server

```bash
# Clean animated mode (shows public URL + password, with live log indicator)
auvrynt start

# Verbose mode (shows full request logs in terminal)
auvrynt serve
```

After startup, the terminal shows:

```
Auvrynt is running!

  Public URL:     https://your-tunnel.trycloudflare.com/mcp
  Owner Password: <your-generated-password>

  # CTRL + C to stop

  ⠋ Logs active... (0 requests handled | Last: Started successfully)
```

---

## Connect an MCP Client

Paste your `/mcp` URL into your AI client (ChatGPT, Claude, etc.):

```
https://your-tunnel.trycloudflare.com/mcp
```

When the client connects, you will be prompted to approve the session using the **Owner password** shown at startup. The password is also stored in:

```
~/.auvrynt/auth.json
```

Keep it private.

---

## Commands

| Command | Description |
|---|---|
| `auvrynt init` | Run first-time setup or update your config |
| `auvrynt start` | Start the server with clean animated output |
| `auvrynt serve` | Start the server with verbose log output |
| `auvrynt doctor` | Show your config, Node version, and dependency health |
| `auvrynt config get` | Print your saved configuration |
| `auvrynt config set publicBaseUrl <url>` | Update your public tunnel URL |

**Override the tunnel URL for a one-off run:**

```bash
AUVRYNT_PUBLIC_BASE_URL=https://new-tunnel.example.com auvrynt start
```

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

| Platform | Status |
|---|---|
| Linux | ✅ Supported |
| macOS | ✅ Supported |
| Windows (Git Bash / WSL / MSYS2) | ✅ Supported |
| Windows PowerShell / cmd.exe only | ❌ Not supported — use Git Bash or WSL |

**Check your environment:**

```bash
auvrynt doctor
```

---

## Configuration

Config files are stored in `~/.auvrynt/`:

```
~/.auvrynt/config.json   ← ports, roots, public URL
~/.auvrynt/auth.json     ← owner password (keep private)
```

Key environment variables:

| Variable | Description |
|---|---|
| `AUVRYNT_ALLOWED_ROOTS` | Comma-separated project root paths |
| `AUVRYNT_PUBLIC_BASE_URL` | Your public tunnel origin (no `/mcp`) |
| `AUVRYNT_OAUTH_OWNER_TOKEN` | Override the owner password directly |
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
