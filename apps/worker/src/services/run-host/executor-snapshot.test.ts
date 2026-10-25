import { expect, it } from "vitest";
import type { TaskSnapshot } from "@meowbert/run-executor/agent/types";
import { createExecutorSnapshot } from "./executor-snapshot.js";

it.each([
  { type: "app", app_slug: "my-app", default_org: "org", private_key_pem: "server-signing-key" },
  { type: "oauth", github_login: "member", default_org: "org", access_token: "server-oauth-token" },
  null
])("removes snapshot credentials while retaining GitHub identity and the server copy: %j", (connection) => {
  const snapshot = { task: { id: "task" }, initiator_user: { id: "owner", byo_api_key: "server-model-key" },
    github_connection: connection } as unknown as TaskSnapshot;
  const original = JSON.stringify(snapshot);
  const publicSnapshot = createExecutorSnapshot(snapshot);
  expect(publicSnapshot.initiator_user).toEqual({ id: "owner" });
  expect(publicSnapshot.github_connection ?? {}).not.toHaveProperty("private_key_pem");
  expect(publicSnapshot.github_connection ?? {}).not.toHaveProperty("access_token");
  expect(JSON.stringify(publicSnapshot)).not.toMatch(/server-signing-key|server-oauth-token|server-model-key/);
  if (connection) expect(publicSnapshot.github_connection).toMatchObject({ type: connection.type, default_org: "org" });
  expect(JSON.stringify(snapshot)).toBe(original);
});

it("preserves a snapshot without an initiator or connection", () => {
  const snapshot = { initiator_user: null, github_connection: null } as TaskSnapshot;
  expect(createExecutorSnapshot(snapshot)).toEqual(snapshot);
});
