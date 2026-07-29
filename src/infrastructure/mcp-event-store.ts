import { randomUUID } from "node:crypto";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type {
  EventId,
  EventStore,
  StreamId,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

interface StoredEvent {
  eventId: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
  storedAt: number;
  bytes: number;
}

export interface BoundedMcpEventStoreOptions {
  maxEvents?: number;
  maxBytes?: number;
  maxEventBytes?: number;
  retentionMs?: number;
  now?: () => number;
}

export const DEFAULT_MCP_EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MCP_EVENT_LIMIT = 2_048;
export const DEFAULT_MCP_EVENT_STORE_BYTES = 3 * 1024 * 1024;
export const DEFAULT_MCP_SINGLE_EVENT_BYTES = 1024 * 1024;

/**
 * Per-session replay storage for MCP SSE reconnects. It is deliberately bounded
 * by age and count so a long-running web-agent connection cannot grow memory
 * without limit.
 */
export class BoundedMcpEventStore implements EventStore {
  private readonly events: StoredEvent[] = [];
  private readonly eventsById = new Map<EventId, StoredEvent>();
  private readonly maxEvents: number;
  private readonly maxBytes: number;
  private readonly maxEventBytes: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private totalBytes = 0;

  constructor(options: BoundedMcpEventStoreOptions = {}) {
    this.maxEvents = positiveInteger(options.maxEvents, DEFAULT_MCP_EVENT_LIMIT);
    this.maxBytes = positiveInteger(options.maxBytes, DEFAULT_MCP_EVENT_STORE_BYTES);
    this.maxEventBytes = Math.min(
      positiveInteger(options.maxEventBytes, DEFAULT_MCP_SINGLE_EVENT_BYTES),
      this.maxBytes,
    );
    this.retentionMs = positiveInteger(options.retentionMs, DEFAULT_MCP_EVENT_RETENTION_MS);
    this.now = options.now ?? Date.now;
  }

  async storeEvent(streamId: StreamId, message: JSONRPCMessage): Promise<EventId> {
    const storedAt = this.now();
    this.prune(storedAt);

    const eventId = `evt-${storedAt.toString(36)}-${randomUUID()}`;
    const measuredBytes = serializedBytes(message);
    const replayMessage = measuredBytes > this.maxEventBytes
      ? replayTooLargeMessage(message, measuredBytes, this.maxEventBytes)
      : message;
    const bytes = serializedBytes(replayMessage);
    const event = { eventId, streamId, message: replayMessage, storedAt, bytes };
    this.events.push(event);
    this.eventsById.set(eventId, event);
    this.totalBytes += bytes;
    this.prune(storedAt);
    return eventId;
  }

  async getStreamIdForEventId(eventId: EventId): Promise<StreamId | undefined> {
    this.prune(this.now());
    return this.eventsById.get(eventId)?.streamId;
  }

  async replayEventsAfter(
    lastEventId: EventId,
    options: { send: (eventId: EventId, message: JSONRPCMessage) => Promise<void> },
  ): Promise<StreamId> {
    this.prune(this.now());
    const lastEvent = this.eventsById.get(lastEventId);
    if (!lastEvent) return "";

    let found = false;
    for (const event of this.events) {
      if (event.streamId !== lastEvent.streamId) continue;
      if (event.eventId === lastEventId) {
        found = true;
        continue;
      }
      if (found) await options.send(event.eventId, event.message);
    }
    return lastEvent.streamId;
  }

  size(): number {
    this.prune(this.now());
    return this.events.length;
  }

  byteSize(): number {
    this.prune(this.now());
    return this.totalBytes;
  }

  private prune(now: number): void {
    const oldestAllowed = now - this.retentionMs;
    while (
      this.events.length > 0
      && (
        this.events[0].storedAt < oldestAllowed
        || this.events.length > this.maxEvents
        || this.totalBytes > this.maxBytes
      )
    ) {
      const removed = this.events.shift();
      if (removed) {
        this.eventsById.delete(removed.eventId);
        this.totalBytes = Math.max(0, this.totalBytes - removed.bytes);
      }
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function serializedBytes(message: JSONRPCMessage): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

function replayTooLargeMessage(
  message: JSONRPCMessage,
  actualBytes: number,
  limitBytes: number,
): JSONRPCMessage {
  const id = "id" in message ? message.id : null;
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32002,
      message: `The original ${actualBytes}-byte result exceeded the ${limitBytes}-byte replay limit. Retry with a narrower request.`,
    },
  } as JSONRPCMessage;
}
