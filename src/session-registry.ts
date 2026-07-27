import { randomUUID } from "node:crypto";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logEvent, sessionIdPrefix } from "./logger.js";
import type { ServerConfig } from "./config.js";

export type SessionState = "creating" | "active" | "disconnected" | "closing" | "expired";

type Transport = StreamableHTTPServerTransport;

export interface SessionRecord {
  sessionId: string;
  ownerClientId: string;
  state: SessionState;
  transport: Transport;
  mcpServer: McpServer;
  roomId?: string;
  workspaceId?: string;
  createdAt: number;
  lastActivityAt: number;
  disconnectedAt?: number;
}

const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const DISCONNECT_GRACE_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_SESSIONS = 32;

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: Pick<ServerConfig, "logging">,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  create(
    transport: Transport,
    mcpServer: McpServer,
    ownerClientId: string,
    roomId?: string,
    workspaceId?: string,
  ): SessionRecord {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`Session capacity reached (max ${MAX_SESSIONS})`);
    }

    const sessionId = transport.sessionId;
    if (!sessionId) {
      throw new Error("Transport has no sessionId");
    }

    const record: SessionRecord = {
      sessionId,
      ownerClientId,
      state: "creating",
      transport,
      mcpServer,
      roomId,
      workspaceId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    this.sessions.set(sessionId, record);
    return record;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  require(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown session: ${sessionId}`);
    return record;
  }

  transition(sessionId: string, newState: SessionState): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    const oldState = record.state;
    record.state = newState;
    record.lastActivityAt = Date.now();
    if (newState === "disconnected") record.disconnectedAt = Date.now();
    logEvent(this.config.logging, "debug", "session_state", {
      sessionIdPrefix: sessionIdPrefix(sessionId),
      oldState,
      newState,
    });
  }

  touch(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (record) record.lastActivityAt = Date.now();
  }

  remove(sessionId: string): SessionRecord | undefined {
    const record = this.sessions.get(sessionId);
    if (record) {
      this.sessions.delete(sessionId);
    }
    return record;
  }

  findByOwner(ownerClientId: string): SessionRecord[] {
    const result: SessionRecord[] = [];
    for (const record of this.sessions.values()) {
      if (record.ownerClientId === ownerClientId) result.push(record);
    }
    return result;
  }

  findByRoom(roomId: string): SessionRecord[] {
    const result: SessionRecord[] = [];
    for (const record of this.sessions.values()) {
      if (record.roomId === roomId) result.push(record);
    }
    return result;
  }

  activeCount(): number {
    let count = 0;
    for (const record of this.sessions.values()) {
      if (record.state === "active" || record.state === "disconnected") count++;
    }
    return count;
  }

  allRecords(): SessionRecord[] {
    return Array.from(this.sessions.values());
  }

  close(): void {
    clearInterval(this.cleanupTimer);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [sessionId, record] of this.sessions) {
      if (record.state === "expired") {
        this.sessions.delete(sessionId);
        continue;
      }
      if (record.state === "disconnected" && record.disconnectedAt) {
        if (now - record.disconnectedAt > DISCONNECT_GRACE_MS) {
          record.state = "expired";
          logEvent(this.config.logging, "info", "session_expired", {
            sessionIdPrefix: sessionIdPrefix(sessionId),
            reason: "disconnect_grace_expired",
          });
        }
        continue;
      }
      if (now - record.lastActivityAt > IDLE_TIMEOUT_MS) {
        if (record.state === "active") {
          record.state = "disconnected";
          record.disconnectedAt = now;
          logEvent(this.config.logging, "info", "session_disconnected", {
            sessionIdPrefix: sessionIdPrefix(sessionId),
            reason: "idle_timeout",
          });
          continue;
        }
        if (record.state === "creating") {
          record.state = "expired";
          logEvent(this.config.logging, "info", "session_expired", {
            sessionIdPrefix: sessionIdPrefix(sessionId),
            reason: "never_initialized",
          });
          this.sessions.delete(sessionId);
        }
      }
    }
  }
}
