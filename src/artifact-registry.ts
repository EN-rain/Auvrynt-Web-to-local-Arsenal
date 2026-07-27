import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { eq, and, desc } from "drizzle-orm";
import type { AppDatabase } from "./db/client.js";
import { artifacts, type NewArtifactRow, type ArtifactRow } from "./db/schema.js";

export function createArtifactRegistry(db: AppDatabase) {
  async function record(params: {
    workspaceSessionId: string;
    path: string;
    mimeType?: string;
    toolName?: string;
  }): Promise<string> {
    const id = `art_${randomUUID()}`;
    let sizeBytes: string | undefined;
    try {
      const fileStat = await stat(params.path);
      sizeBytes = String(fileStat.size);
    } catch {}

    const row: NewArtifactRow = {
      id,
      workspaceSessionId: params.workspaceSessionId,
      path: params.path,
      mimeType: params.mimeType ?? null,
      toolName: params.toolName ?? null,
      sizeBytes: sizeBytes ?? null,
      createdAt: new Date().toISOString(),
    };
    db.insert(artifacts).values(row).run();
    return id;
  }

  function list(workspaceSessionId: string): ArtifactRow[] {
    return db
      .select()
      .from(artifacts)
      .where(eq(artifacts.workspaceSessionId, workspaceSessionId))
      .orderBy(desc(artifacts.createdAt))
      .all();
  }

  function remove(id: string): void {
    db.delete(artifacts).where(eq(artifacts.id, id)).run();
  }

  function count(workspaceSessionId: string): number {
    const result = db
      .select({ count: artifacts.id })
      .from(artifacts)
      .where(eq(artifacts.workspaceSessionId, workspaceSessionId))
      .all();
    return result.length;
  }

  return { record, list, remove, count };
}

export type ArtifactRegistry = ReturnType<typeof createArtifactRegistry>;
