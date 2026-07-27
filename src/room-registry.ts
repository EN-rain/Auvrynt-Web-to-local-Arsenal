export type RoomState = "active" | "disconnected" | "closing" | "closed";

export interface RoomRecord {
  roomId: string;
  ownerClientId: string;
  workspaceId: string;
  state: RoomState;
  createdAt: number;
  closedAt?: number;
}

export class RoomRegistry {
  private readonly rooms = new Map<string, RoomRecord>();

  create(ownerClientId: string, workspaceId: string): RoomRecord {
    const roomId = `room_${workspaceId}`;
    const existing = this.rooms.get(roomId);
    if (existing && existing.state !== "closed") {
      return existing;
    }

    const record: RoomRecord = {
      roomId,
      ownerClientId,
      workspaceId,
      state: "active",
      createdAt: Date.now(),
    };
    this.rooms.set(roomId, record);
    return record;
  }

  get(roomId: string): RoomRecord | undefined {
    return this.rooms.get(roomId);
  }

  getByWorkspace(workspaceId: string): RoomRecord | undefined {
    for (const record of this.rooms.values()) {
      if (record.workspaceId === workspaceId && record.state !== "closed") {
        return record;
      }
    }
    return undefined;
  }

  close(roomId: string): void {
    const record = this.rooms.get(roomId);
    if (record) {
      record.state = "closed";
      record.closedAt = Date.now();
    }
  }

  findByOwner(ownerClientId: string): RoomRecord[] {
    const result: RoomRecord[] = [];
    for (const record of this.rooms.values()) {
      if (record.ownerClientId === ownerClientId) result.push(record);
    }
    return result;
  }

  allRooms(): RoomRecord[] {
    return Array.from(this.rooms.values());
  }
}
