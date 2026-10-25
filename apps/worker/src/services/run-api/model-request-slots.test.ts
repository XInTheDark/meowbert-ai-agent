import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ locks: new Map<string, object>(), clients: [] as EventEmitter[], destroyed: [] as boolean[] }));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  class Client extends EventEmitter {
    async query(sql: string, [key]: string[]) {
      if (sql.includes("pg_try_advisory_lock")) {
        if (db.locks.has(key)) return { rows: [{ acquired: false }] };
        db.locks.set(key, this);
        return { rows: [{ acquired: true }] };
      }
      if (db.locks.get(key) === this) db.locks.delete(key);
      return { rows: [] };
    }
    release(destroyed: boolean) {
      db.destroyed.push(destroyed);
      if (destroyed) for (const [key, client] of db.locks) if (client === this) db.locks.delete(key);
    }
  }
  class Pool extends EventEmitter {
    async connect() { const client = new Client(); db.clients.push(client); return client; }
    async end() {}
  }
  return { Pool };
});
import { createUserModelRequestSlots, MODEL_REQUESTS_PER_USER } from "./model-request-slots.js";
afterEach(() => { db.clients.length = 0; db.destroyed.length = 0; db.locks.clear(); });

it("bounds one user across worker pools while admitting another user and releasing finished requests", async () => {
  const first = createUserModelRequestSlots("test"), second = createUserModelRequestSlots("test");
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const signal = new AbortController().signal;
  const admitted = Array.from({ length: MODEL_REQUESTS_PER_USER }, (_, index) =>
    (index % 2 ? first : second).withSlot("user", signal, async () => gate));
  try {
    await vi.waitFor(() => expect(db.locks.size).toBe(MODEL_REQUESTS_PER_USER));
    await expect(second.withSlot("user", signal, async () => "unexpected")).rejects.toMatchObject({ code: "rate_limited" });
    await expect(second.withSlot("another-user", signal, async () => "ok")).resolves.toBe("ok");
    finish(); await Promise.all(admitted);
    expect(db.locks.size).toBe(0);
    await expect(first.withSlot("user", signal, async () => { throw new Error("provider failed"); })).rejects.toThrow("provider failed");
    expect(db.locks.size).toBe(0);
  } finally { finish(); await Promise.allSettled(admitted); await first.close(); await second.close(); }
});

it("aborts an upstream request if its slot connection dies and destroys the broken connection", async () => {
  const slots = createUserModelRequestSlots("test");
  const pending = slots.withSlot("user", new AbortController().signal, async (signal) => {
    await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("connection lost")), { once: true }));
  });
  const assertion = expect(pending).rejects.toThrow("connection lost");
  await vi.waitFor(() => expect(db.locks.size).toBe(1));
  db.clients[0].emit("error", new Error("database disconnected"));
  await assertion;
  expect(db.destroyed).toContain(true);
  expect(db.locks.size).toBe(0);
  await slots.close();
});
