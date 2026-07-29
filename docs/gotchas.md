# Troubleshooting Gotchas

This page collects the setup issues users are most likely to hit.

## `auvrynt` Command Not Found

Use `npx`:

```bash
npx auvrynt init
npx auvrynt start
```

If you installed globally, confirm npm's global bin directory is on `PATH`.

## Unsupported Node Version

Auvrynt requires Node `>=20.12 <27`.

Check:

```bash
node --version
```

Install Node 22 LTS with your preferred version manager such as `nvm`, `fnm`, or
`mise`.

## `better-sqlite3` Could Not Load

This usually means native dependencies were installed under a different Node
runtime.

Try:

```bash
npm rebuild better-sqlite3
```

Then run:

```bash
npx auvrynt doctor
```

Release starts run a native dependency check before launching.

## Public URL Includes `/mcp`

Use the origin for setup:

```text
https://your-tunnel-host.example.com
```

Use the MCP endpoint in the client:

```text
https://your-tunnel-host.example.com/mcp
```

If you saved the wrong value:

```bash
npx auvrynt config set publicBaseUrl https://your-tunnel-host.example.com
```

## Tunnel URL Changed

The managed tunnel URL stays unchanged across `auvrynt add`, same-directory `auvrynt start ... --replace`, and `auvrynt restart`. An assigned Cloudflare or ngrok URL normally changes after `auvrynt restart hard` or `auvrynt stop` followed by a new start. A reserved ngrok origin configured through `auvrynt tunnel` or `AUVRYNT_NGROK_URL` remains stable as long as that reservation is available.

Auvrynt reads ngrok's structured startup logs for the URL created by the exact child process it launched. It does not query the shared `127.0.0.1:4040` inspector API, which avoids accidentally adopting a different local ngrok process when multiple agents are running.

If the public tunnel temporarily becomes unreachable while the local server is healthy, Auvrynt leaves the existing tunnel process in place so it can reconnect with the same URL. It does not silently replace the tunnel because a replacement assigned URL would no longer match the running OAuth issuer and resource configuration. Use `auvrynt restart hard` only when you intentionally accept replacement behavior or have configured a stable ngrok origin.

Managed background starts also schedule bounded crash recovery for fatal Node.js errors. The replacement server waits for the failed process to exit, reuses the same managed tunnel URL and profile arguments, and stops after five restart attempts in ten minutes to prevent a crash loop.

## Repeated 502 During Extended Use

A repeated 502 does not always mean the tunnel itself failed. It can also mean the local process was terminated, a long-running response stayed silent too long, or a tool result exceeded a connector/proxy payload limit.

Auvrynt now protects the long-use paths by:

- Sending an SSE heartbeat every 15 seconds during long MCP streams.
- Bounding replay history by time, count, and bytes.
- Truncating oversized text/metadata and omitting connector-dangerous inline binary.
- Saving oversized screenshots and renders locally instead of embedding large base64 responses.
- Force-closing stuck Chromium processes.
- Applying backpressure to Blender and Godot queues.
- Releasing closed room/workspace state and failed Serena sessions.

When Auvrynt reports that a result was truncated, retry with a narrower read range, fewer search results, or a smaller screenshot/render. Use `start_process` rather than a blocking shell request for servers or other indefinitely running commands.

## Profile Changes While Connected

`auvrynt add`, `auvrynt change`, and same-directory `auvrynt start --replace` no longer close MCP sessions. Long-lived SSE requests do not block the change. If a tool is currently executing, the local control request retries transient `409`, `429`, `502`, `503`, and `504` responses before reporting failure.

For a stable independently managed URL, use foreground mode:

```bash
npx auvrynt config set publicBaseUrl https://auvrynt.example.com
npx auvrynt serve
```

## Host Header Or 403 Problems

Auvrynt derives allowed hosts from the configured public URL.

Run:

```bash
npx auvrynt doctor
```

Confirm the public URL hostname appears in allowed hosts. If you changed tunnel
URLs, update `publicBaseUrl`.

Use this only for intentional local debugging:

```bash
AUVRYNT_ALLOWED_HOSTS="*" npx auvrynt start
```

## OAuth Redirect Host Rejected

By default, Auvrynt allows redirects for:

```text
chatgpt.com
localhost
127.0.0.1
```

If another MCP client uses a different redirect host, configure:

```bash
AUVRYNT_OAUTH_ALLOWED_REDIRECT_HOSTS="chatgpt.com,example.com" npx auvrynt start
```

## Owner Token Not Accepted

Make sure you are entering the Owner token from:

```text
~/.auvrynt/auth.json
```

To regenerate setup:

```bash
npx auvrynt init --force
```

## Unknown `workspaceId`

`workspaceId` values are session identifiers. If the server restarts and the
client receives an unknown workspace error, call `open_workspace` again for that
project.

Workspace session metadata is persisted, but clients should still treat
`open_workspace` as the way to begin a fresh working session.

## Workspace Path Rejected

The path must be inside one of the allowed roots configured during setup.

Run:

```bash
npx auvrynt config get
```

Then either open a project under an allowed root or rerun setup:

```bash
npx auvrynt init --force
```

## Worktree Mode Fails

Worktree mode requires:

- Git installed
- the path is inside a Git repository
- the repository has at least one commit
- the requested `baseRef` resolves to a commit

For a new repository, create the first commit or use checkout mode.

Uncommitted source checkout changes are not copied into the managed worktree.
Commit, stash, or ask the model to work in checkout mode if those changes are
needed.

## Windows Shell Commands Fail

Auvrynt shell execution requires Bash. Native PowerShell and `cmd.exe` command
execution are not supported yet.

Install Git for Windows and use Git Bash, or use WSL, MSYS2, or Cygwin Bash.

Run:

```bash
npx auvrynt doctor
```

Confirm Bash is detected.

## Skills Do Not Appear

Skills are enabled by default. Check:

```bash
AUVRYNT_SKILLS=1 npx auvrynt start
```

Auvrynt looks in:

- `AUVRYNT_AGENT_DIR`, defaulting to `~/.codex`
- project `.pi/skills`
- `AUVRYNT_SKILL_PATHS`

If a skill appears in `open_workspace`, the model must read that skill's
`SKILL.md` before reading other files inside the skill directory.

## Review Card Does Not Appear

Per-tool widget cards are enabled by default with:

```bash
AUVRYNT_WIDGETS=full
```

The aggregate `show_changes` tool is only exposed with
`AUVRYNT_WIDGETS=changes`. Plain MCP clients may ignore ChatGPT Apps widget
metadata and only show text results.
