# Setup Guide

This guide is for users who want ChatGPT or another MCP host to work in local
projects through Auvrynt.

## Requirements

- Node `>=20.12 <27`; Node 22 LTS is recommended
- npm
- Git
- Bash, including Git Bash or WSL on Windows
- a public HTTPS URL that forwards to the local Auvrynt server

Auvrynt does not create the public tunnel for you. Use Cloudflare Tunnel,
ngrok, Pinggy, Tailscale Funnel, or your own HTTPS reverse proxy.

## Install And Configure

Run:

```bash
npx auvrynt init
```

The setup flow asks one question at a time.

### Project Roots

Choose the folders ChatGPT is allowed to open through Auvrynt. Keep this
narrow.

Examples:

```text
~/personal,~/work
```

```text
/Users/alice/dev,/Users/alice/work
```

```text
C:\Users\alice\dev,C:\Users\alice\work
```

### Local Port

The default is `49321`.

The local MCP URL is:

```text
http://127.0.0.1:49321/mcp
```

### Public Base URL

Start your tunnel or reverse proxy before entering this value. Point the tunnel
at:

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

```bash
npx auvrynt start
```

If your tunnel URL changes for one run, override it without rewriting config:

```bash
AUVRYNT_PUBLIC_BASE_URL="https://new-tunnel.example.com" npx auvrynt start
```

For a stable public URL, persist it:

```bash
npx auvrynt config set publicBaseUrl https://auvrynt.example.com
npx auvrynt start
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
