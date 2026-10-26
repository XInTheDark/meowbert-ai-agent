import { randomUUID } from "node:crypto";
import type { ModelGateway } from "./ports/model-gateway.js";

// A provider session can advance even when its response is lost. Keep the replacement for
// later turns on this gateway, while leaving the prompt cache key and conversation intact.
const replacements = new WeakMap<ModelGateway, Map<string, string>>();

export function resolveModelRequestSession(models: ModelGateway, sessionId: string, affinityKey?: string, reset = false) {
  const key = JSON.stringify([sessionId, affinityKey]);
  let sessions = replacements.get(models);
  if (reset) {
    if (!sessions) { sessions = new Map(); replacements.set(models, sessions); }
    sessions.set(key, randomUUID());
  }
  const suffix = sessions?.get(key);
  return {
    requestSessionId: suffix ? sessionId + ":" + suffix : sessionId,
    ...(affinityKey ? { sessionAffinityKey: suffix ? affinityKey + ":" + suffix : affinityKey } : {})
  };
}
