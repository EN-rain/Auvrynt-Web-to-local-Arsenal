import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logEvent, sessionIdPrefix } from "../logger.js";
import type { ServerConfig } from "../config.js";

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
  inFlightRequests: number;
}

export interface SessionRegistryOptions {
  now?: () => number;
  sessionIdleTimeoutMs?: number;
  disconnectGraceMs?: number;
  cleanupIntervalMs?: number;
  maxSessions?: number;
  maxSessionsPerOwner?: number;
  startCleanupTimer?: boolean;
}

export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_DISCONNECT_GRACE_MS = 12 * 60 * 60 * 1000;
export const DEFAULT_SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_SESSIONS = 64;
export const DEFAULT_MAX_SESSIONS_PER_OWNER = 8;

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly cleanupTimer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;
  private readonly sessionIdleTimeoutMs: number;
  private readonly disconnectGraceMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly maxSessions: number;
  private readonly maxSessionsPerOwner: number;
  private cleanupInFlight = false;

  constructor(
    private readonly config: Pick<ServerConfig, "logging">,
    options: SessionRegistryOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.sessionIdleTimeoutMs = positiveMs(
      options.sessionIdleTimeoutMs,
      positiveEnvMs("AUVRYNT_SESSION_IDLE_MS", DEFAULT_SESSION_IDLE_TIMEOUT_MS),
    );
    this.disconnectGraceMs = positiveMs(
      options.disconnectGraceMs,
      positiveEnvMs("AUVRYNT_DISCONNECT_GRACE_MS", DEFAULT_DISCONNECT_GRACE_MS),
    );
    this.cleanupIntervalMs = positiveMs(options.cleanupIntervalMs, DEFAULT_SESSION_CLEANUP_INTERVAL_MS);
    this.maxSessions = positiveInteger(options.maxSessions, DEFAULT_MAX_SESSIONS);
    this.maxSessionsPerOwner = Math.min(
      this.maxSessions,
      positiveInteger(
        options.maxSessionsPerOwner,
        positiveEnvInteger("AUVRYNT_MAX_SESSIONS_PER_CLIENT", DEFAULT_MAX_SESSIONS_PER_OWNER),
      ),
    );

    if (options.startCleanupTimer !== false) {
      this.cleanupTimer = setInterval(() => void this.cleanupSafely(), this.cleanupIntervalMs);
      this.cleanupTimer.unref();
    }
  }

  create(
    transport: Transport,
    mcpServer: McpServer,
    ownerClientId: string,
    roomId?: string,
    workspaceId?: string,
  ): SessionRecord {
    if (!this.evictForOwnerCapacity(ownerClientId)) {
      throw new Error(`Client session capacity reached (max ${this.maxSessionsPerOwner})`);
    }
    this.evictForCapacity();
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Session capacity reached (max ${this.maxSessions})`);
    }

    const sessionId = transport.sessionId;
    if (!sessionId) throw new Error("Transport has no sessionId");

    const now = this.now();
    const record: SessionRecord = {
      sessionId,
      ownerClientId,
      state: "creating",
      transport,
      mcpServer,
      roomId,
      workspaceId,
      createdAt: now,
      lastActivityAt: now,
      inFlightRequests: 0,
    };

    this.sessions.set(sessionId, record);
    return record;
  }

  canCreate(ownerClientId?: string): boolean {
    if (ownerClientId && !this.evictForOwnerCapacity(ownerClientId)) return false;
    this.evictForCapacity();
    return this.sessions.size < this.maxSessions;
  }

  isAtCapacity(): boolean {
    return this.sessions.size >= this.maxSessions;
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
    const now = this.now();
    record.state = newState;
    record.lastActivityAt = now;
    record.disconnectedAt = newState === "disconnected" ? now : undefined;
    logEvent(this.config.logging, "debug", "session_state", {
      sessionIdPrefix: sessionIdPrefix(sessionId),
      oldState,
      newState,
    });
  }

  touch(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.lastActivityAt = this.now();
    if (record.state === "disconnected") {
      record.state = "active";
      record.disconnectedAt = undefined;
    }
  }

  beginRequest(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.inFlightRequests += 1;
    this.touch(sessionId);
  }

  endRequest(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    record.inFlightRequests = Math.max(0, record.inFlightRequests - 1);
    record.lastActivityAt = this.now();
  }

  bindWorkspace(sessionId: string, roomId: string, workspaceId: string): void {
    const record = this.require(sessionId);
    record.roomId = roomId;
    record.workspaceId = workspaceId;
    record.lastActivityAt = this.now();
  }

  remove(sessionId: string): SessionRecord | undefined {
    const record = this.sessions.get(sessionId);
    if (record) this.sessions.delete(sessionId);
    return record;
  }

  findByOwner(ownerClientId: string): SessionRecord[] {
    return [...this.sessions.values()].filter((record) => record.ownerClientId === ownerClientId);
  }

  findByRoom(roomId: string): SessionRecord[] {
    return [...this.sessions.values()].filter((record) => record.roomId === roomId);
  }

  activeCount(): number {
    let count = 0;
    for (const record of this.sessions.values()) {
      if (record.state === "active" || record.state === "disconnected") count++;
    }
    return count;
  }

  countByState(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const record of this.sessions.values()) {
      counts[record.state] = (counts[record.state] || 0) + 1;
    }
    return counts;
  }

  allRecords(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  close(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async cleanupNow(now = this.now()): Promise<number> {
    const evicted: SessionRecord[] = [];

    for (const [sessionId, record] of this.sessions) {
      if (record.state === "expired") {
        this.sessions.delete(sessionId);
        evicted.push(record);
        continue;
      }

      if (record.state === "disconnected" && record.disconnectedAt !== undefined) {
        if (now - record.disconnectedAt >= this.disconnectGraceMs) {
          record.state = "expired";
          this.sessions.delete(sessionId);
          evicted.push(record);
          logEvent(this.config.logging, "info", "session_expired", {
            sessionIdPrefix: sessionIdPrefix(sessionId),
            reason: "disconnect_grace_expired",
          });
        }
        continue;
      }

      if (
        record.state === "active"
        && record.inFlightRequests === 0
        && now - record.lastActivityAt >= this.sessionIdleTimeoutMs
      ) {
        record.state = "disconnected";
        record.disconnectedAt = now;
        record.lastActivityAt = now;
        logEvent(this.config.logging, "info", "session_disconnected", {
          sessionIdPrefix: sessionIdPrefix(sessionId),
          reason: "idle_timeout",
        });
        continue;
      }

      if (record.state === "creating" && now - record.lastActivityAt >= this.sessionIdleTimeoutMs) {
        record.state = "expired";
        this.sessions.delete(sessionId);
        evicted.push(record);
        logEvent(this.config.logging, "info", "session_expired", {
          sessionIdPrefix: sessionIdPrefix(sessionId),
          reason: "never_initialized",
        });
        continue;
      }

      if (record.state === "closing" && now - record.lastActivityAt >= this.cleanupIntervalMs) {
        this.sessions.delete(sessionId);
        evicted.push(record);
        logEvent(this.config.logging, "info", "session_evicted", {
          sessionIdPrefix: sessionIdPrefix(sessionId),
          reason: "closing_stuck",
        });
      }
    }

    await Promise.allSettled(evicted.map((record) => this.closeRecord(record)));
    return evicted.length;
  }

  private async cleanupSafely(): Promise<void> {
    if (this.cleanupInFlight) return;
    this.cleanupInFlight = true;
    try {
      await this.cleanupNow();
    } finally {
      this.cleanupInFlight = false;
    }
  }

  private evictForCapacity(): void {
    if (this.sessions.size < this.maxSessions) return;

    const candidate = [...this.sessions.values()]
      .filter((record) => record.state === "expired" || record.state === "closing" || record.state === "disconnected")
      .sort((left, right) => evictionTimestamp(left) - evictionTimestamp(right))[0];
    if (!candidate) return;

    this.sessions.delete(candidate.sessionId);
    logEvent(this.config.logging, "info", "session_evicted", {
      sessionIdPrefix: sessionIdPrefix(candidate.sessionId),
      reason: "capacity_recovery",
    });
    void this.closeRecord(candidate);
  }

  private evictForOwnerCapacity(ownerClientId: string): boolean {
    const owned = [...this.sessions.values()]
      .filter((record) => record.ownerClientId === ownerClientId);
    if (owned.length < this.maxSessionsPerOwner) return true;

    const candidates = owned
      .filter((record) => record.inFlightRequests === 0)
      .sort((left, right) => {
        const stateDifference = evictionPriority(left.state) - evictionPriority(right.state);
        return stateDifference || evictionTimestamp(left) - evictionTimestamp(right);
      });
    const removeCount = owned.length - this.maxSessionsPerOwner + 1;
    const evicted = candidates.slice(0, removeCount);
    if (evicted.length < removeCount) return false;
    for (const record of evicted) {
      this.sessions.delete(record.sessionId);
      logEvent(this.config.logging, "info", "session_evicted", {
        sessionIdPrefix: sessionIdPrefix(record.sessionId),
        reason: "owner_session_limit",
      });
      void this.closeRecord(record);
    }
    return true;
  }

  private async closeRecord(record: SessionRecord): Promise<void> {
    try {
      await record.mcpServer.close();
    } catch (error) {
      logEvent(this.config.logging, "warn", "session_close_failed", {
        sessionIdPrefix: sessionIdPrefix(record.sessionId),
        error: error instanceof Error ? error.message : String(error),
      });
      await record.transport.close().catch(() => undefined);
    }
  }
}

function evictionTimestamp(record: SessionRecord): number {
  return record.disconnectedAt ?? record.lastActivityAt;
}

function evictionPriority(state: SessionState): number {
  if (state === "expired") return 0;
  if (state === "closing") return 1;
  if (state === "disconnected") return 2;
  if (state === "creating") return 3;
  return 4;
}

function positiveEnvMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function positiveEnvInteger(name: string, fallback: number): number {
  return positiveInteger(Number(process.env[name]), fallback);
}

function positiveMs(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}
