import type { TaskSnapshot } from "@meowbert/run-executor/agent/types";

// The server retains the original snapshot for provider resolution and token minting.
export function createExecutorSnapshot(snapshot: TaskSnapshot): TaskSnapshot {
  const initiator = snapshot.initiator_user ? { ...snapshot.initiator_user } : null;
  if (initiator) delete initiator.byo_api_key;
  const connection = snapshot.github_connection ? { ...snapshot.github_connection } : null;
  if (connection?.type === "app") delete connection.private_key_pem;
  if (connection?.type === "oauth") delete connection.access_token;
  return { ...snapshot, initiator_user: initiator, github_connection: connection };
}
