import type { BridgeServerStatus } from "@meowbert/shared";

export function buildBridgeMcpConfigJson(status: Pick<BridgeServerStatus, "endpointUrl" | "bearerToken">): string {
  return JSON.stringify(
    {
      mcpServers: {
        "meowbert-bridge": {
          url: status.endpointUrl ?? "http://127.0.0.1:38471/mcp",
          headers: {
            Authorization: `Bearer ${status.bearerToken}`
          }
        }
      }
    },
    null,
    2
  );
}
