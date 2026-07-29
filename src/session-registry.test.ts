import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_DISCONNECT_GRACE_MS,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  SessionRegistry,
} from "./session-registry.js";

const loggingConfig = {
  level: "silent" as const,
  format: "json" as const,
  requests: false,
  assets: false,
  toolCalls: false,
  shellCommands: false,
};
const config = { logging: loggingConfig };

function makeTransport(closeCounter?: { value: number }): any {
  return {
    sessionId: `sess_${randomUUID()}`,
    close: async () => { if (closeCounter) closeCounter.value++; },
  };
}

function makeServer(closeCounter?: { value: number }): any {
  return {
    close: async () => { if (closeCounter) closeCounter.value++; },
  };
}

{
  let now = 0;
  const registry = new SessionRegistry(config, { now: () => now, startCleanupTimer: false });
  const session = registry.create(makeTransport(), makeServer(), "client1", "room1", "ws1");

  assert.equal(session.state, "creating");
  registry.transition(session.sessionId, "active");
  now = 12 * 60 * 60 * 1000;
  await registry.cleanupNow();
  assert.equal(registry.get(session.sessionId)?.state, "active", "active session must survive 12 hours");

  now = DEFAULT_SESSION_IDLE_TIMEOUT_MS;
  await registry.cleanupNow();
  assert.equal(registry.get(session.sessionId)?.state, "disconnected");
  registry.close();
}

{
  let now = 0;
  const closed = { value: 0 };
  const registry = new SessionRegistry(config, { now: () => now, startCleanupTimer: false });
  const session = registry.create(makeTransport(), makeServer(closed), "client1");
  registry.transition(session.sessionId, "active");
  registry.transition(session.sessionId, "disconnected");

  now = DEFAULT_DISCONNECT_GRACE_MS - 1;
  await registry.cleanupNow();
  assert.equal(registry.get(session.sessionId)?.state, "disconnected");

  now = DEFAULT_DISCONNECT_GRACE_MS;
  assert.equal(await registry.cleanupNow(), 1);
  assert.equal(registry.get(session.sessionId), undefined);
  assert.equal(closed.value, 1, "expired session server must be closed");
  registry.close();
}

{
  let now = 0;
  const registry = new SessionRegistry(config, {
    now: () => now,
    maxSessions: 2,
    startCleanupTimer: false,
  });
  const old = registry.create(makeTransport(), makeServer(), "client1");
  registry.transition(old.sessionId, "disconnected");
  now = 1;
  const active = registry.create(makeTransport(), makeServer(), "client1");
  registry.transition(active.sessionId, "active");
  now = 2;
  const replacement = registry.create(makeTransport(), makeServer(), "client1");

  assert.equal(registry.get(old.sessionId), undefined, "oldest disconnected session should be evicted at capacity");
  assert.ok(registry.get(active.sessionId));
  assert.ok(registry.get(replacement.sessionId));
  registry.close();
}

{
  const closed = { value: 0 };
  const registry = new SessionRegistry(config, { maxSessions: 1, startCleanupTimer: false });
  const active = registry.create(makeTransport(), makeServer(closed), "client1");
  registry.transition(active.sessionId, "active");
  assert.equal(registry.canCreate(), false);
  const replacement = registry.create(makeTransport(), makeServer(), "client1");
  assert.equal(registry.get(active.sessionId), undefined);
  assert.ok(registry.get(replacement.sessionId));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed.value, 1);
  registry.close();
}

{
  let now = 0;
  const closed = { value: 0 };
  const registry = new SessionRegistry(config, {
    now: () => now,
    maxSessions: 8,
    maxSessionsPerOwner: 2,
    startCleanupTimer: false,
  });
  const oldest = registry.create(makeTransport(), makeServer(closed), "client1");
  registry.transition(oldest.sessionId, "active");
  now = 1;
  const current = registry.create(makeTransport(), makeServer(closed), "client1");
  registry.transition(current.sessionId, "active");
  now = 2;
  const replacement = registry.create(makeTransport(), makeServer(closed), "client1");

  assert.equal(registry.get(oldest.sessionId), undefined, "oldest duplicate client session should be evicted");
  assert.ok(registry.get(current.sessionId));
  assert.ok(registry.get(replacement.sessionId));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed.value, 1, "evicted duplicate client session must be closed");
  registry.close();
}

{
  const registry = new SessionRegistry(config, {
    maxSessions: 8,
    maxSessionsPerOwner: 1,
    startCleanupTimer: false,
  });
  const active = registry.create(makeTransport(), makeServer(), "client1");
  registry.transition(active.sessionId, "active");
  registry.beginRequest(active.sessionId);

  assert.equal(registry.canCreate("client1"), false, "in-flight client session must not be evicted");
  assert.throws(
    () => registry.create(makeTransport(), makeServer(), "client1"),
    /Client session capacity reached/,
  );
  registry.endRequest(active.sessionId);
  assert.equal(registry.canCreate("client1"), true, "idle duplicate client session can be reclaimed");
  registry.close();
}

{
  const registry = new SessionRegistry(config, { startCleanupTimer: false });
  const session = registry.create(makeTransport(), makeServer(), "owner1");
  registry.bindWorkspace(session.sessionId, "myroom", "workspace1");
  assert.equal(registry.get(session.sessionId)?.roomId, "myroom");
  assert.equal(registry.get(session.sessionId)?.workspaceId, "workspace1");
  registry.transition(session.sessionId, "disconnected");
  registry.touch(session.sessionId);

  assert.equal(registry.get(session.sessionId)?.state, "active");
  assert.equal(registry.get(session.sessionId)?.disconnectedAt, undefined);
  assert.equal(registry.findByOwner("owner1").length, 1);
  assert.equal(registry.findByRoom("myroom").length, 1);
  assert.ok(registry.remove(session.sessionId));
  assert.equal(registry.get(session.sessionId), undefined);
  registry.close();
}

console.log("Session registry tests passed!");
