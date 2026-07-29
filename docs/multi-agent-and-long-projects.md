# Long Projects and Multiple MCP Agents

## Long checklist-driven projects

Auvrynt can support a long project plan stored in Markdown, including plans with 20 or more checklist items.

Recommended pattern:

```markdown
# Project Plan

## Current state
- Active workspace: `<workspaceId>`
- Last verified step: 7
- Current blocker: none

## Checklist
- [x] 1. Inspect architecture
- [x] 2. Add focused tests
- [ ] 3. Implement the next component
- [ ] 4. Verify the component
```

The Markdown file is durable local state. It survives MCP reconnects, client restarts, and Auvrynt process restarts because it is an ordinary project file. Workspace metadata is also persisted.

Auvrynt does not independently schedule the checklist or continue executing after the model host stops sending tool calls. ChatGPT, Claude, or another MCP host remains responsible for:

- Reading the plan.
- Choosing the next unchecked item.
- Updating each item after verification.
- Writing a short current-state handoff before a session ends.
- Resuming from the file after a context reset or reconnect.

For reliable progress, update checklist lines using complete line-delimited text so similarly numbered items such as `Task 1` and `Task 10` are not ambiguous exact-edit matches.

## Room ownership

Each `open_workspace` call creates a unique workspace and room. The room records:

- OAuth client owner.
- Workspace ID.
- Lifecycle state.
- Session association.

Every workspace-bound tool call now checks the authenticated OAuth client against the room owner before resolving the workspace. Knowing another agent's `workspaceId` is not enough to use it.

A room is an authorization and lifecycle boundary. It is not:

- A task scheduler.
- A chat channel between agents.
- A file-locking service.
- A merge coordinator.
- A replacement for Git branches or worktrees.

## ChatGPT and Claude on different directories

This is the simplest supported multi-agent arrangement:

```text
ChatGPT OAuth client -> workspace A -> C:\Projects\frontend
Claude OAuth client  -> workspace B -> C:\Projects\backend
```

The two clients receive different workspace IDs, rooms, process ownership, and path roots. Cross-client use of the other workspace ID is rejected.

The directories must both be inside the configured Auvrynt allowed roots. A directory-scoped `auvrynt start` normally exposes only the directory from which it was started, so use a common allowed parent or run the agents from appropriately scoped instances when the directories are unrelated.

## Two agents on the same repository

Opening the same checkout twice creates two workspace IDs and two owner-protected rooms, but both still point at the same physical files. That protects credentials and tool access; it does not prevent edit conflicts.

For concurrent changes in the same Git repository, each agent should use an isolated worktree:

```text
ChatGPT -> open_workspace(path, mode="worktree") -> worktree A
Claude  -> open_workspace(path, mode="worktree") -> worktree B
```

Each agent can then commit or produce a patch independently. A human or designated integration agent should review and merge the results.

## Long-duration limits

Auvrynt's server-side safeguards support long sessions through bounded replay, heartbeats, payload limits, resource cleanup, persisted workspaces, and a 12-hour disconnected-session grace period. This does not guarantee that a model host will autonomously continue for a fixed number of hours. Host context limits, account limits, client disconnects, computer sleep, network loss, and tunnel-provider outages remain external constraints.
