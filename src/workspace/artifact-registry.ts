import { randomUUID, createHash } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import { normalize, isAbsolute, sep } from "node:path";
import { eq, desc, sql } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { artifacts, type NewArtifactRow, type ArtifactRow } from "../db/schema.js";

function isValidPath(path: string): boolean {
  if (!path || path === "" || path.includes("\0")) return false;
  if (isAbsolute(path)) return false;
  const normalized = normalize(path);
  const parts = normalized.split(sep);
  if (parts.includes("..")) return false;
  return true;
}

export function createArtifactRegistry(db: AppDatabase) {
  async function record(params: {
    workspaceSessionId: string;
    ownerClientId: string;
    path: string;
    mimeType?: string;
    toolName?: string;
  }): Promise<string> {
    if (!isValidPath(params.path)) {
      throw new Error(`Invalid or unsafe path: ${params.path}`);
    }
    const id = `art_${randomUUID()}`;
    let sizeBytes: string | undefined;
    let sha256: string | undefined;
    try {
      const fileStat = await stat(params.path);
      sizeBytes = String(fileStat.size);
      const content = await readFile(params.path);
      sha256 = createHash("sha256").update(content).digest("hex");
    } catch {}

    const row: NewArtifactRow = {
      id,
      workspaceSessionId: params.workspaceSessionId,
      ownerClientId: params.ownerClientId,
      status: "available",
      sha256,
      path: params.path,
      mimeType: params.mimeType ?? null,
      toolName: params.toolName ?? null,
      sizeBytes: sizeBytes ?? null,
      createdAt: new Date().toISOString(),
    };
    db.insert(artifacts).values(row).run();
    return id;
  }

  function list(
    workspaceSessionId: string,
    limit = 50,
    offset = 0,
  ): ArtifactRow[] {
    return db
      .select()
      .from(artifacts)
      .where(eq(artifacts.workspaceSessionId, workspaceSessionId))
      .orderBy(desc(artifacts.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
  }

  function remove(id: string): void {
    db.delete(artifacts).where(eq(artifacts.id, id)).run();
  }

  function count(workspaceSessionId: string): number {
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(artifacts)
      .where(eq(artifacts.workspaceSessionId, workspaceSessionId))
      .get();
    return result?.count ?? 0;
  }

  return { record, list, remove, count };
}

export type ArtifactRegistry = ReturnType<typeof createArtifactRegistry>;
