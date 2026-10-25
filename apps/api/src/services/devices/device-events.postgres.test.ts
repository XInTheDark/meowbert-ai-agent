import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Opt-in integration test; use a disposable local PostgreSQL database.
describe.skipIf(!process.env.DEVICE_EVENTS_TEST_DATABASE_URL)("device execution notifications (PostgreSQL)", () => {
  const schema = "device_events_" + randomUUID().replaceAll("-", "");
  const writer = new Client({connectionString:process.env.DEVICE_EVENTS_TEST_DATABASE_URL});
  const listener = new Client({connectionString:process.env.DEVICE_EVENTS_TEST_DATABASE_URL});
  const messages: Array<{deviceId:string|null;kind:string}> = [];
  const a=randomUUID();const b=randomUUID();const run=randomUUID();
  beforeAll(async () => {
    await writer.connect(); await listener.connect();
    await writer.query('CREATE SCHEMA "'+schema+'"'); await writer.query('SET search_path TO "'+schema+'"');
    await writer.query("CREATE TABLE devices(id uuid PRIMARY KEY, revoked_at timestamptz); CREATE TABLE task_run_dispatches(run_id uuid PRIMARY KEY,queue_state text,payload_json jsonb); CREATE TABLE platform_settings(id int,sandbox_image_reference text,sandbox_image_digest text); CREATE TABLE workspaces(id uuid,file_host jsonb); CREATE TABLE workspace_members(workspace_id uuid,user_id uuid); CREATE TABLE device_file_tombstones(id uuid,device_id uuid,not_before timestamptz)");
    await writer.query(await fs.readFile(new URL("../../../../../db/migrations/148_device_execution_notifications.sql",import.meta.url),"utf8"));
    await writer.query("INSERT INTO devices(id) VALUES ($1),($2)",[a,b]);
    await writer.query("INSERT INTO platform_settings VALUES (1,'image:main','sha256:old')");
    listener.on("notification", notification => messages.push(JSON.parse(notification.payload!)));
    await listener.query("LISTEN device_execution_changed");
  });
  afterAll(async () => {
    await writer.query("ROLLBACK"); await writer.query('DROP SCHEMA "'+schema+'" CASCADE');
    await Promise.all([writer.end(),listener.end()]);
  });
  it("publishes only committed dispatch changes including admission, and covers both devices on retarget", async () => {
    await writer.query("BEGIN");
    await writer.query("INSERT INTO task_run_dispatches VALUES ($1,'pending',$2::jsonb)",[run,JSON.stringify({executionTarget:{kind:"local",deviceId:a}})]);
    await listener.query("SELECT 1"); expect(messages).toHaveLength(0);
    await writer.query("ROLLBACK"); await listener.query("SELECT 1"); expect(messages).toHaveLength(0);
    await writer.query("INSERT INTO task_run_dispatches VALUES ($1,'pending',$2::jsonb)",[run,JSON.stringify({executionTarget:{kind:"local",deviceId:a}})]);
    await expect.poll(()=>messages.length).toBe(1); expect(messages[0]).toEqual({deviceId:a,kind:"runs"});
    await writer.query("UPDATE task_run_dispatches SET queue_state='admitted' WHERE run_id=$1",[run]);
    await expect.poll(()=>messages.length).toBe(2);
    await writer.query("UPDATE task_run_dispatches SET payload_json=$2::jsonb WHERE run_id=$1",[run,JSON.stringify({executionTarget:{kind:"local",deviceId:b}})]);
    await expect.poll(()=>messages.length).toBe(4);
    expect(messages.slice(-2)).toEqual([{deviceId:a,kind:"runs"},{deviceId:b,kind:"runs"}]);
  });
  it("pushes image changes, future cleanup deadlines and revocation, with no event for unchanged pins", async () => {
    messages.length=0;
    await writer.query("UPDATE platform_settings SET sandbox_image_digest='sha256:new'");
    await expect.poll(()=>messages.length).toBe(1); expect(messages[0]).toEqual({deviceId:null,kind:"config"});
    await writer.query("UPDATE platform_settings SET sandbox_image_digest='sha256:new'"); await listener.query("SELECT 1");
    expect(messages).toHaveLength(1);
    await writer.query("INSERT INTO device_file_tombstones VALUES ($1,$2,now()+interval '90 seconds')",[randomUUID(),a]);
    await expect.poll(()=>messages.length).toBe(2); expect(messages[1]).toEqual({deviceId:a,kind:"cleanup"});
    await writer.query("UPDATE devices SET revoked_at=now() WHERE id=$1",[a]);
    await expect.poll(()=>messages.length).toBe(3); expect(messages[2]).toEqual({deviceId:a,kind:"revoked"});
  });
});
