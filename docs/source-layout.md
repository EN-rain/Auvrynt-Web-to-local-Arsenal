# Source Layout

Auvrynt keeps package entry points at the root of `src` and groups implementation code by responsibility.

## Entry points

- `src/cli.ts` — command routing only. It compiles to the published `dist/cli.js` executable.
- `src/server.ts` — HTTP, OAuth, MCP transport, session, readiness, and shutdown composition. It compiles to the published `dist/server.js` entry point.

These files intentionally remain at the root because `package.json` publishes those output paths.

## Domain folders

```text
src/
├── auth/            OAuth, sessions, rooms, connected-client state
├── cli/             commands, foreground serving, lifecycle management
├── db/              SQLite client and schema
├── infrastructure/  configuration, logging, HTTP/SSE, queues, payload budgets
├── integrations/
│   ├── blender/
│   ├── dotnet/
│   ├── godot/
│   ├── images/
│   ├── playwright/
│   └── serena/
├── process/         managed processes, retries, crash recovery, background lifecycle
├── server/          MCP policy, tool registration, UI resources, tool families
├── tools/           shared MCP tool adapters
├── tunnels/         Cloudflare and ngrok implementations
└── workspace/       workspace registry, persistence, worktrees, search, skills
```

## Root compatibility files

Most non-test `src/*.ts` files are intentionally tiny re-export facades. They preserve existing import paths while implementation code lives in the domain folders. New runtime implementation must not be added to these facades.

All non-entry root runtime files are now compatibility facades. The final three implementation bodies (`blender-tools.ts`, `serena-manager.ts`, `serena-tools.ts`) have been moved into their respective integration domain folders:

- `src/integrations/blender/blender-tools.ts`
- `src/integrations/serena/serena-manager.ts`
- `src/integrations/serena/serena-tools.ts`

The root files re-export from the domain paths. New server code imports the organized domain paths directly.

## Tests

Tests currently remain beside their historical root import paths because `scripts/run-tests.mjs` treats each `src/*.test.ts` file as an executable test entry point. Tests may be colocated with implementations in a later dedicated test-runner migration, but production code should not depend on test location.

## Placement rules

- Add authentication or session state under `auth/`.
- Add transport, configuration, logging, or bounded-resource helpers under `infrastructure/`.
- Add workspace filesystem and persistence behavior under `workspace/`.
- Add process ownership or lifecycle behavior under `process/`.
- Add integration-specific behavior under its `integrations/<name>/` folder.
- Keep `cli.ts` and `server.ts` composition-only.
- Do not add new root implementation files.

`src/architecture-boundaries.test.ts` enforces these rules.
