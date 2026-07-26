# Setup Guide

This guide is for users who want ChatGPT or another MCP host to work in local
projects through Auvrynt.

## Requirements

- Node `>=20.12 <27`; Node 22 LTS is recommended
- npm
- Git for Windows (includes the Bash runtime used by agent shell tools)
- Windows PowerShell or cmd.exe
- Internet access for the managed Cloudflare quick tunnel

`auvrynt start` installs Cloudflare Tunnel when needed and creates a temporary
public URL automatically.

## Install And Start

Run:

```powershell
npm install -g auvrynt
cd C:\path\to\your\project
auvrynt start
```

The first start creates local configuration and asks which optional
integrations to enable. The launch directory becomes the only project root
available to that managed instance.

Run `auvrynt init` only if you want to configure foreground `auvrynt serve`
manually. That setup flow asks one question at a time:

### Project Roots

Choose the folders ChatGPT is allowed to open through Auvrynt. Keep this
narrow.

Example: `C:\Users\alice\dev,C:\Users\alice\work`.

### Local Port

The default is `49321`.

The local MCP URL is:

```text
http://127.0.0.1:49321/mcp
```

### Public Base URL

This setting applies to foreground `auvrynt serve`; managed `auvrynt start`
creates its own Cloudflare URL. Point your independently managed tunnel at:

```text
http://127.0.0.1:49321
```

Enter the public origin without `/mcp`:

```text
https://your-tunnel-host.example.com
```

Configure the MCP client with the full MCP endpoint:

```text
https://your-tunnel-host.example.com/mcp
```

## Start The Server

Run:

```powershell
auvrynt start
```

The command starts in the background and returns only after both the local
server and Cloudflare tunnel are ready. It always limits web-agent file access
to the directory where you ran it.

Use `auvrynt add web` (or another profile) to update the running instance
without restarting the server or tunnel. Use `auvrynt stop` to stop both
managed processes.

For an independently managed stable URL, configure it and use foreground
`auvrynt serve`:

```powershell
auvrynt config set publicBaseUrl https://auvrynt.example.com
auvrynt serve
```

## Approve The Client

When ChatGPT, Claude, or another MCP client connects, Auvrynt shows an Owner
token approval page. Enter the Owner token shown during setup, or retrieve it later with `auvrynt token`.

The default config files are:

```text
~/.auvrynt/config.json
~/.auvrynt/auth.json
```

Keep `auth.json` private.

## Check Your Setup

Run:

```bash
npx auvrynt doctor
```

The doctor command reports the resolved config, Node version, Node ABI, platform,
Git, Bash, public URL, allowed hosts, and SQLite native dependency status.

## Running From A Local Checkout

If you are developing Auvrynt itself instead of using the published package:

```bash
npm install --include=dev
npm run dev
```

The same setup rules apply.
