import type { Tool } from "openai/resources/responses/responses";
import { canonicalizeModelPayload } from "@meowbert/run-executor/agent/model";
import { normalizeProviderRequestTools } from "@meowbert/run-executor/agent/provider-request-tools";
import type { RunControl } from "@meowbert/run-executor/agent/ports/run-control";
import type { ServerRunState } from "../run-host/bootstrap.js";
import { builtinRunTools, auxiliaryTools, type DeviceToolConsent } from "./builtin-tool-policy.js";
import { createSkillToolPolicy } from "./skill-tool-policy.js";
import { RunApiFailure } from "./failure.js";

// Descriptions may reflect lazy tool discovery; executable contracts must match exactly.
export function toolContract(tool: Tool): string {
  const { description: _description, ...contract } = tool as unknown as Record<string, unknown>;
  return JSON.stringify(canonicalizeModelPayload(contract));
}

export function createModelToolPolicy(state: ServerRunState, control: RunControl, consent: DeviceToolConsent) {
  const normalize = (tools: Tool[]) => normalizeProviderRequestTools(tools, state.bootstrap.runtime.modelType);
  const builtin = normalize(builtinRunTools(state, consent));
  const skills = createSkillToolPolicy(state, control, consent);
  return async (tools: Tool[], purpose: string): Promise<void> => {
    const allowed = purpose === "turn" ? builtin : normalize(auxiliaryTools(purpose));
    const seen = new Set<string>();
    for (const tool of tools) {
      if ((tool.type === "function" || tool.type === "custom") && typeof tool.name !== "string") {
        throw new RunApiFailure("invalid_request", "Invalid model tool name.");
      }
      const key = tool.type + ":" + ("name" in tool ? tool.name : "");
      if (seen.has(key)) throw new RunApiFailure("invalid_request", "Duplicate model tool.");
      seen.add(key);
      const contract = toolContract(tool);
      if (allowed.some((candidate) => toolContract(candidate) === contract)) continue;
      if (purpose === "turn" && tool.type === "function" && tool.name.includes("__")) {
        if (normalize(await skills(tool.name)).some((candidate) => toolContract(candidate) === contract)) continue;
      }
      throw new RunApiFailure("invalid_request", "The model tool does not match this run's allowed tool definitions.");
    }
  };
}
