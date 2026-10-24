import type { Response } from "openai/resources/responses/responses";
import type { ModelGateway } from "../agent/ports/model-gateway.js";
import type { RunApiClient } from "./client.js";

// Model calls through the control plane's model proxy: the server holds the provider keys, picks
// the model, and bills each call to the run.
export function createProxyModelGateway(client: RunApiClient): ModelGateway {
  return {
    async create(request) {
      const result = await client.model({
        purpose: request.purpose,
        body: request.body,
        ...(request.headers ? { headers: request.headers } : {}),
        timeoutMs: request.timeoutMs,
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        ...(request.attempt ? { attempt: request.attempt } : {})
      }, request.signal);
      return { response: result.response as Response, weightedTokens: result.weightedTokens };
    },
    isQuotaExceeded: async () => await client.call("model.isQuotaExceeded", []) as boolean
  };
}
