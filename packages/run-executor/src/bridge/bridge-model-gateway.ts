import type { ModelGateway } from "../agent/ports/model-gateway.js";
import type { BridgeSession } from "./bridge-session.js";

export interface BridgeModelGatewayOptions {
  session: BridgeSession;
  fallback?: ModelGateway;
}

// Reverses control for `turn` requests so an external harness drives Meowbert through MCP,
// while delegating auxiliary calls (`title`, `web_search`) to the configured default model.
export function createBridgeModelGateway(options: BridgeModelGatewayOptions): ModelGateway {
  const { session, fallback } = options;

  return {
    async create(request) {
      if (request.purpose === "turn") {
        const response = await session.handleModelTurn(request.body, request.signal);
        return { response, weightedTokens: null };
      }
      if (request.purpose === "compaction") {
        throw new Error("Context compaction is disabled during Bridge mode.");
      }
      if (!fallback) {
        throw new Error(`No default model configured for auxiliary purpose "${request.purpose}".`);
      }
      return fallback.create(request);
    },
    isQuotaExceeded: async () => false
  };
}
