import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzip as gunzipCallback, gzip as gzipCallback } from "node:zlib";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  archiveTaskHistory,
  ensureTaskHistoryWarm,
  getTaskHistoryArchiveHealth,
  normalizeTaskHistoryArchiveConfig,
  type TaskHistoryArchiveQueryable
} from "./task-history-archive.js";

const gunzip = promisify(gunzipCallback);
const gzip = promisify(gzipCallback);

const lifecycleIds = {
  task: "11111111-1111-1111-1111-111111111111",
  workspace: "22222222-2222-2222-2222-222222222222",
  environment: "33333333-3333-3333-3333-333333333333",
  message: "44444444-4444-4444-4444-444444444444",
  event: "55555555-5555-5555-5555-555555555555",
  revision: "66666666-6666-6666-6666-666666666666",
  workflowMessage: "77777777-7777-7777-7777-777777777777",
  contextItem: "88888888-8888-8888-8888-888888888888",
  note: "99999999-9999-9999-9999-999999999999"
} as const;

function buildLifecycleSnapshot(state: "warm" | "archiving" | "archived", archiveKey: string | null) {
  return {
    id: lifecycleIds.task,
    workspace_id: lifecycleIds.workspace,
    environment_id: lifecycleIds.environment,
    status: "completed",
    schedule_state: null,
    task_history_state: state,
    task_history_archive_key: archiveKey,
    task_history_archive_failed_attempts: 0,
    task_history_last_active_at: new Date("2026-01-01T00:00:00.000Z"),
    task_history_last_warmed_at: null
  };
}

function createLifecycleArchiveClient(executedSql: string[] = []): TaskHistoryArchiveQueryable {
  let snapshotCount = 0;
  return {
    async query<T extends object>(text: string): Promise<{ rows: T[]; rowCount: number | null }> {
      executedSql.push(text);
      if (text.includes("FROM tasks t") && text.includes("LEFT JOIN task_schedules ts")) {
        snapshotCount += 1;
        return {
          rows: [buildLifecycleSnapshot(snapshotCount === 1 ? "warm" : "archiving", null) as T],
          rowCount: 1
        };
      }
      if (text.includes("SELECT id, role, content_json, token_usage_json")) {
        return { rows: [{
          id: lifecycleIds.message,
          role: "assistant",
          content_json: { text: "Archived answer" },
          token_usage_json: { total_tokens: 42 }
        } as T], rowCount: 1 };
      }
      if (text.includes("SELECT id, payload_json") && text.includes("FROM task_events")) {
        return { rows: [{ id: lifecycleIds.event, payload_json: { message: "event" } } as T], rowCount: 1 };
      }
      if (text.includes("SELECT id, old_content_json, new_content_json")) {
        return { rows: [{
          id: lifecycleIds.revision,
          old_content_json: { text: "before" },
          new_content_json: { text: "after" }
        } as T], rowCount: 1 };
      }
      if (text.includes("SELECT id, payload_json FROM task_context_history_items")) {
        return { rows: [{id: lifecycleIds.contextItem, payload_json: {type: "function_call_output", output: "Private history"}} as T], rowCount: 1 };
      }
      if (text.includes("SELECT id, content FROM task_context_notes")) {
        return { rows: [{id: lifecycleIds.note, content: "Branch notes"} as T], rowCount: 1 };
      }
      if (text.includes("SELECT m.id, m.content_markdown")) {
        return { rows: [{ id: lifecycleIds.workflowMessage, content_markdown: "Swarm output" } as T], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  };
}

describe("ensureTaskHistoryWarm", () => {
  it("locks only the task row when loading archive snapshots", async () => {
    const executedSql: string[] = [];

    const client: TaskHistoryArchiveQueryable = {
      async query<T extends object>(text: string): Promise<{ rows: T[]; rowCount: number | null }> {
        executedSql.push(text);

        if (text.includes("FROM tasks t") && text.includes("LEFT JOIN task_schedules ts")) {
          return {
            rows: [{
              id: "11111111-1111-1111-1111-111111111111",
              workspace_id: "22222222-2222-2222-2222-222222222222",
              environment_id: "33333333-3333-3333-3333-333333333333",
              status: "completed",
              schedule_state: null,
              task_history_state: "warm",
              task_history_archive_key: null,
              task_history_archive_failed_attempts: 0,
              task_history_last_active_at: "2026-01-01T00:00:00.000Z",
              task_history_last_warmed_at: null
            } as T],
            rowCount: 1
          };
        }

        return {
          rows: [],
          rowCount: 0
        };
      }
    };

    const result = await ensureTaskHistoryWarm("11111111-1111-1111-1111-111111111111", {
      archiveConfig: {
        enabled: true,
        mountPath: "/tmp/archive-mount",
        archivesDir: "tasks",
        rootPath: "/tmp/archive-mount/tasks"
      },
      db: {
        query: client.query,
        withTransaction: async <T>(fn: (tx: TaskHistoryArchiveQueryable) => Promise<T>) => fn(client)
      }
    });

    expect(result).toEqual({ status: "warm" });
    expect(executedSql.some((sql) =>
      sql.includes("LEFT JOIN task_schedules ts")
      && sql.includes("FOR UPDATE OF t")
    )).toBe(true);
  });
});

describe("archiveTaskHistory", () => {
  it("writes a gzip archive with size metrics and restores its payloads", async () => {
    const mountPath = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-history-archive-"));
    const archiveConfig = {
      enabled: true,
      mountPath,
      archivesDir: "tasks",
      rootPath: path.join(mountPath, "tasks")
    };
    try {
      const archiveSql: string[] = [];
      const archiveClient = createLifecycleArchiveClient(archiveSql);
      const archived = await archiveTaskHistory(lifecycleIds.task, {
        archiveConfig,
        db: {
          query: archiveClient.query,
          withTransaction: async <T>(fn: (tx: TaskHistoryArchiveQueryable) => Promise<T>) => fn(archiveClient)
        },
        now: () => new Date("2026-01-02T00:00:00.000Z")
      });

      expect(archived.status).toBe("archived");
      expect(archiveSql).toContain("UPDATE task_context_history_items SET payload_json = '{}'::jsonb WHERE task_id = $1");
      expect(archiveSql).toContain("UPDATE task_context_notes SET content = '' WHERE task_id = $1");
      expect(archived.metrics).toMatchObject({
        messageCount: 1,
        eventCount: 1,
        revisionCount: 1,
        workflowMessageCount: 1
      });
      expect(archived.metrics?.originalSizeBytes).toBeGreaterThan(archived.metrics?.compressedSizeBytes ?? 0);

      const archivePath = path.join(archiveConfig.rootPath, archived.archiveKey ?? "");
      const document = JSON.parse((await gunzip(await fsPromises.readFile(archivePath))).toString("utf8"));
      expect(document.messages[0].content_json).toEqual({ text: "Archived answer" });
      expect(document.events[0].payload_json).toEqual({ message: "event" });
      expect(document.context.history[0]).toEqual({id: lifecycleIds.contextItem, payload_json: {type: "function_call_output", output: "Private history"}});
      expect(document.context.notes[0]).toEqual({id: lifecycleIds.note, content: "Branch notes"});

      const restoreUpdates: Array<{ text: string; params?: unknown[] }> = [];
      const restoreClient: TaskHistoryArchiveQueryable = {
        async query<T extends object>(text: string, params?: unknown[]) {
          if (text.includes("FROM tasks t") && text.includes("LEFT JOIN task_schedules ts")) {
            return {
              rows: [buildLifecycleSnapshot("archived", archived.archiveKey ?? null) as T],
              rowCount: 1
            };
          }
          restoreUpdates.push({ text, params });
          return { rows: [], rowCount: 1 };
        }
      };
      const restored = await ensureTaskHistoryWarm(lifecycleIds.task, {
        archiveConfig,
        db: {
          query: restoreClient.query,
          withTransaction: async <T>(fn: (tx: TaskHistoryArchiveQueryable) => Promise<T>) => fn(restoreClient)
        }
      });

      expect(restored.status).toBe("restored");
      expect(restoreUpdates).toEqual(expect.arrayContaining([
        {text: expect.stringContaining("UPDATE task_context_history_items"), params: [lifecycleIds.contextItem, JSON.stringify(document.context.history[0].payload_json)]},
        {text: expect.stringContaining("UPDATE task_context_notes"), params: [lifecycleIds.note, "Branch notes"]}
      ]));
      expect(restoreUpdates.some(({ text, params }) =>
        text.includes("UPDATE task_messages")
        && params?.[1] === JSON.stringify({ text: "Archived answer" })
      )).toBe(true);
      expect(restoreUpdates.some(({ text, params }) =>
        text.includes("UPDATE task_events")
        && params?.[1] === JSON.stringify({ message: "event" })
      )).toBe(true);
    } finally {
      await fsPromises.rm(mountPath, { recursive: true, force: true });
    }
  });

  it("increments the archive failure counter when a prepared archive cannot be written", async () => {
    const executedSql: string[] = [];
    const failureUpdates: Array<{ text: string; params: unknown[] | undefined }> = [];

    const client: TaskHistoryArchiveQueryable = {
      async query<T extends object>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
        executedSql.push(text);

        if (text.includes("FROM tasks t") && text.includes("LEFT JOIN task_schedules ts")) {
          return {
            rows: [{
              id: "11111111-1111-1111-1111-111111111111",
              workspace_id: "22222222-2222-2222-2222-222222222222",
              environment_id: "33333333-3333-3333-3333-333333333333",
              status: "completed",
              schedule_state: null,
              task_history_state: "warm",
              task_history_archive_key: null,
              task_history_archive_failed_attempts: 0,
              task_history_last_active_at: "2026-01-01T00:00:00.000Z",
              task_history_last_warmed_at: null
            } as T],
            rowCount: 1
          };
        }

        return {
          rows: [],
          rowCount: text.trim().startsWith("UPDATE tasks") ? 1 : 0
        };
      }
    };

    await expect(archiveTaskHistory("11111111-1111-1111-1111-111111111111", {
      archiveConfig: {
        enabled: true,
        mountPath: "/dev/null",
        archivesDir: "meowbert-archive-test",
        rootPath: "/dev/null/meowbert-archive-test"
      },
      db: {
        query: async <T extends object>(text: string, params?: unknown[]) => {
          failureUpdates.push({ text, params });
          return { rows: [] as T[], rowCount: 1 };
        },
        withTransaction: async <T>(fn: (tx: TaskHistoryArchiveQueryable) => Promise<T>) => fn(client)
      },
      now: () => new Date("2026-01-02T00:00:00.000Z")
    })).rejects.toThrow();

    const failureUpdate = failureUpdates.find(({ text }) => text.includes("task_history_archive_failed_attempts"));
    expect(failureUpdate?.text).toContain(
      "task_history_archive_failed_attempts = task_history_archive_failed_attempts + 1"
    );
    expect(failureUpdate?.params?.[0]).toBe("11111111-1111-1111-1111-111111111111");
    expect(executedSql.some((sql) => sql.includes("task_history_state = 'archiving'"))).toBe(true);
  });
});

describe("normalizeTaskHistoryArchiveConfig", () => {
  it("treats a configured mount path as provisioned storage", () => {
    const config = normalizeTaskHistoryArchiveConfig({
      baseDir: "/srv/meowbert",
      rawTaskHistoryArchive: {
        mountPath: "./runtime/archive",
        archivesDir: "cold-storage/tasks"
      }
    });

    expect(config).toEqual({
      enabled: true,
      mountPath: "/srv/meowbert/runtime/archive",
      archivesDir: "cold-storage/tasks",
      rootPath: "/srv/meowbert/runtime/archive/cold-storage/tasks"
    });
  });

  it("reports storage as unconfigured when no mount path is supplied", () => {
    expect(normalizeTaskHistoryArchiveConfig({ baseDir: "/srv/meowbert" })).toEqual({
      enabled: false,
      mountPath: null,
      archivesDir: "task-history",
      rootPath: null
    });
  });
});

describe("archiveTaskHistory skip reasons", () => {
  it("explains when archive storage is not configured", async () => {
    const result = await archiveTaskHistory(lifecycleIds.task, {
      archiveConfig: {
        enabled: false,
        mountPath: null,
        archivesDir: "task-history",
        rootPath: null
      },
      db: {
        query: async <T extends object>() => ({ rows: [] as T[], rowCount: 0 }),
        withTransaction: async <T>() => null as T
      }
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "Task history archive storage is not configured."
    });
  });
});

describe("getTaskHistoryArchiveHealth", () => {
  it("reports a mounted archive root that cannot be created", async () => {
    const eio = Object.assign(
      new Error("EIO: i/o error, mkdir '/archive/cold-storage/archives'"),
      { code: "EIO" }
    );

    const health = await getTaskHistoryArchiveHealth(
      {
        enabled: true,
        mountPath: "/archive",
        archivesDir: "cold-storage/archives",
        rootPath: "/archive/cold-storage/archives"
      },
      {
        stat: async () => ({ isDirectory: () => true }),
        isMounted: async () => true,
        mkdir: async () => {
          throw eio;
        },
        writeFile: async () => undefined,
        unlink: async () => undefined
      }
    );

    expect(health).toMatchObject({
      mounted: true,
      state: "error"
    });
    expect(health.message).toContain("Archive root is not writable");
    expect(health.message).toContain("EIO");
  });
});

it("restores legacy archives without overwriting private context that was never archived", async () => {
  const rootPath = await fsPromises.mkdtemp(path.join(os.tmpdir(), "meowbert-legacy-archive-"));
  try {
    const document = {
      version: 1,
      task: {id: lifecycleIds.task, workspace_id: lifecycleIds.workspace, environment_id: lifecycleIds.environment,
        archived_at: "2026-01-01T00:00:00.000Z", last_active_at: "2026-01-01T00:00:00.000Z"},
      messages: [], events: [], message_revisions: [], workflow_messages: []
    };
    await fsPromises.writeFile(path.join(rootPath, "legacy.json.gz"), await gzip(JSON.stringify(document)));
    const sql: string[] = [];
    const client: TaskHistoryArchiveQueryable = {query: async <T extends object>(text: string) => {
      sql.push(text);
      return {rows: text.includes("FROM tasks t") ? [buildLifecycleSnapshot("archived", "legacy.json.gz") as T] : [], rowCount: 1};
    }};
    const restored = await ensureTaskHistoryWarm(lifecycleIds.task, {
      archiveConfig: {enabled:true, mountPath:rootPath, archivesDir:"tasks", rootPath},
      db: {query:client.query, withTransaction: async (fn) => fn(client)}
    });
    expect(restored.status).toBe("restored");
    expect(sql.some((query) => query.includes("UPDATE task_context_"))).toBe(false);
  } finally {
    await fsPromises.rm(rootPath, {recursive:true, force:true});
  }
});
