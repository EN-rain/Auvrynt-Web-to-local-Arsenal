import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { databasePath, openDatabase, type DatabaseHandle } from "../db/client.js";
import {
  workspaceSessions,
  rooms,
  type WorkspaceSessionRow,
} from "../db/schema.js";

export type WorkspaceMode = "checkout" | "worktree";

export interface WorkspaceSession {
  id: string;
  root: string;
  status: string;
  mode: WorkspaceMode;
  sourceRoot?: string;
  baseRef?: string;
  baseSha?: string;
  managed: boolean;
  createdAt: string;
  lastUsedAt: string;
}

export interface WorkspaceStore {
  createSession(input: {
    id: string;
    root: string;
    mode?: WorkspaceMode;
    sourceRoot?: string;
    baseRef?: string;
    baseSha?: string;
    managed?: boolean;
  }): WorkspaceSession;
  getSession(id: string): WorkspaceSession | undefined;
  updateSession(id: string, updates: { status?: string; mode?: WorkspaceMode; root?: string }): void;
  touchSession(id: string): void;
  getDatabase?(): DatabaseHandle;
  close?(): void;
}

const WORKSPACE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PERSISTED_WORKSPACE_SESSIONS = 512;

export class SqliteWorkspaceStore implements WorkspaceStore {
  private readonly database: DatabaseHandle;
  private readonly stateDir: string;

  constructor(stateDir: string) {
    this.database = openDatabase(stateDir);
    this.stateDir = stateDir;
    this.migrate();
    this.pruneStaleSessions();
  }

  createSession(input: {
    id: string;
    root: string;
    mode?: WorkspaceMode;
    sourceRoot?: string;
    baseRef?: string;
    baseSha?: string;
    managed?: boolean;
  }): WorkspaceSession {
    const now = new Date().toISOString();
    const session: WorkspaceSession = {
      id: input.id,
      root: input.root,
      status: "active",
      mode: input.mode ?? "checkout",
      sourceRoot: input.sourceRoot,
      baseRef: input.baseRef,
      baseSha: input.baseSha,
      managed: input.managed ?? false,
      createdAt: now,
      lastUsedAt: now,
    };

    this.database.db
      .insert(workspaceSessions)
      .values({
        id: session.id,
        root: session.root,
        status: session.status,
        mode: session.mode,
        sourceRoot: session.sourceRoot ?? null,
        baseRef: session.baseRef ?? null,
        baseSha: session.baseSha ?? null,
        managed: String(session.managed),
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
      })
      .run();

    return session;
  }

  getSession(id: string): WorkspaceSession | undefined {
    const row = this.database.db
      .select()
      .from(workspaceSessions)
      .where(eq(workspaceSessions.id, id))
      .get();

    return row ? rowToWorkspaceSession(row) : undefined;
  }

  touchSession(id: string): void {
    this.database.db
      .update(workspaceSessions)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(workspaceSessions.id, id))
      .run();
  }

  updateSession(id: string, updates: { status?: string; mode?: WorkspaceMode; root?: string }): void {
    const toSet: Record<string, string> = {};
    if (updates.status !== undefined) toSet.status = updates.status;
    if (updates.mode !== undefined) toSet.mode = updates.mode;
    if (updates.root !== undefined) toSet.root = updates.root;
    if (Object.keys(toSet).length === 0) return;
    this.database.db
      .update(workspaceSessions)
      .set(toSet)
      .where(eq(workspaceSessions.id, id))
      .run();
  }

  getDatabase(): DatabaseHandle {
    return this.database;
  }

  close(): void {
    this.database.close();
  }

  private migrate(): void {
    this.database.sqlite.exec(`
      create table if not exists _migrations (
        name text primary key,
        applied_at text not null
      )
    `);

    const applied = new Set(
      (this.database.sqlite.prepare("select name from _migrations").all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );

    this.database.sqlite.transaction(() => {
      if (!applied.has("v1_core_tables")) {
        this.database.sqlite.exec(`
          create table if not exists workspace_sessions (
            id text primary key,
            root text not null,
            status text not null default 'active',
            mode text not null default 'checkout',
            source_root text,
            base_ref text,
            base_sha text,
            managed text not null default 'false',
            created_at text not null,
            last_used_at text not null
          );

          create index if not exists workspace_sessions_root_idx
            on workspace_sessions(root, last_used_at desc);

          create index if not exists workspace_sessions_status_idx
            on workspace_sessions(status, last_used_at desc);

          create table if not exists loaded_agent_files (
            workspace_session_id text not null,
            path text not null,
            content_hash text not null,
            content text not null,
            loaded_at text not null,
            last_seen_at text not null,
            primary key (workspace_session_id, path),
            foreign key (workspace_session_id)
              references workspace_sessions(id)
              on delete cascade
          );

          create index if not exists loaded_agent_files_path_idx
            on loaded_agent_files(path);

          create table if not exists rooms (
            id text primary key,
            owner_client_id text not null,
            workspace_id text not null unique,
            state text not null default 'active',
            created_at text not null,
            last_activity_at text not null,
            closed_at text
          );

          create index if not exists rooms_workspace_idx
            on rooms(workspace_id);

          create index if not exists rooms_owner_idx
            on rooms(owner_client_id);
        `);
        this.database.sqlite
          .prepare("insert into _migrations (name, applied_at) values (?, ?)")
          .run("v1_core_tables", new Date().toISOString());
      }

      const alterMigrations = [
        { name: "v1_add_mode", column: "mode", def: "text not null default 'checkout'" },
        { name: "v1_add_source_root", column: "source_root", def: "text" },
        { name: "v1_add_base_ref", column: "base_ref", def: "text" },
        { name: "v1_add_base_sha", column: "base_sha", def: "text" },
        { name: "v1_add_managed", column: "managed", def: "text not null default 'false'" },
      ];
      for (const m of alterMigrations) {
        if (!applied.has(m.name)) {
          this.backupDb();
          this.addColumnIfMissing("workspace_sessions", m.column, m.def);
          this.database.sqlite
            .prepare("insert into _migrations (name, applied_at) values (?, ?)")
            .run(m.name, new Date().toISOString());
        }
      }
    })();
  }

  private backupDb(): void {
    const dbPath = databasePath(this.stateDir);
    const backupPath = join(this.stateDir, "auvrynt.sqlite.migrate.bak");
    try {
      copyFileSync(dbPath, backupPath);
    } catch {
      // Backup is best-effort
    }
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.database.sqlite.prepare(`pragma table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (columns.some((existingColumn) => existingColumn.name === column)) return;

    this.database.sqlite.exec(`alter table ${table} add column ${column} ${definition}`);
  }

  private pruneStaleSessions(): void {
    const cutoff = new Date(Date.now() - WORKSPACE_SESSION_TTL_MS).toISOString();
    const transaction = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare("delete from workspace_sessions where last_used_at < ?")
        .run(cutoff);
      this.database.sqlite.prepare(`
        delete from workspace_sessions
        where id in (
          select id from workspace_sessions
          order by last_used_at desc
          limit -1 offset ?
        )
      `).run(MAX_PERSISTED_WORKSPACE_SESSIONS);
    });
    transaction();
  }
}

export function createWorkspaceStore(stateDir: string): WorkspaceStore {
  return new SqliteWorkspaceStore(stateDir);
}

function rowToWorkspaceSession(row: WorkspaceSessionRow): WorkspaceSession {
  return {
    id: row.id,
    root: row.root,
    status: row.status,
    mode: row.mode === "worktree" ? "worktree" : "checkout",
    sourceRoot: row.sourceRoot ?? undefined,
    baseRef: row.baseRef ?? undefined,
    baseSha: row.baseSha ?? undefined,
    managed: row.managed === "true",
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}
