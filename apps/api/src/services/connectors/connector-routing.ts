import { getPlatformAiClient } from "../platform/ai-provider-client.js";
import { getInternalModel } from "../admin/admin-settings.js";
import { extractObjectWithToolCall } from "../../lib/openai-tool-output.js";


const environmentRouteSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    environmentId: { type: "string" },
    reason: { type: "string" },
    confidence: { type: "number" }
  },
  required: ["environmentId", "reason", "confidence"]
};

export interface ConnectorEnvironmentCandidate {
  id: string;
  name: string;
}

export interface ConnectorEnvironmentRouteDecision {
  environmentId: string;
  reason: string;
  confidence: number;
  selectionSource: "default" | "llm" | "fallback";
  usedFallback: boolean;
  fallbackReason?: string;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function fallbackEnvironmentDecision(
  reason: string,
  fallbackEnvironmentId: string
): ConnectorEnvironmentRouteDecision {
  return {
    environmentId: fallbackEnvironmentId,
    reason: `fallback:${reason}`,
    confidence: 0.1,
    selectionSource: "fallback",
    usedFallback: true,
    fallbackReason: reason
  };
}

// Picks which project's Master receives a connector message: the binding's default project when
// it is still active, otherwise a model choice.
export async function decideEnvironmentRoute(input: {
  message: string;
  defaultEnvironmentId?: string;
  environments: ConnectorEnvironmentCandidate[];
}): Promise<ConnectorEnvironmentRouteDecision> {
  if (input.environments.length === 0) {
    throw new Error("No active environments available");
  }

  const defaultEnvironment =
    input.defaultEnvironmentId &&
    input.environments.find((environment) => environment.id === input.defaultEnvironmentId);

  if (defaultEnvironment) {
    return {
      environmentId: defaultEnvironment.id,
      reason: "default_environment",
      confidence: 1,
      selectionSource: "default",
      usedFallback: false
    };
  }

  const openai = await getPlatformAiClient();
  if (!openai) {
    return fallbackEnvironmentDecision("openai_unavailable", input.environments[0].id);
  }

  const contextPayload = {
    incomingMessage: input.message,
    environments: input.environments
  };

  try {
    const extraction = await extractObjectWithToolCall<{
      environmentId?: unknown;
      reason?: unknown;
      confidence?: unknown;
    }>({
      client: openai,
      model: await getInternalModel(),
      toolName: "select_environment_route",
      toolDescription: "Select the best project id for an incoming connector message.",
      schema: environmentRouteSchema,
      input: [
        {
          role: "developer",
          content: [
            "Pick the best project for this incoming message.",
            "environmentId must be one of the provided environments."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify(contextPayload)
        }
      ]
    });

    if (!extraction.ok) {
      return fallbackEnvironmentDecision(extraction.error, input.environments[0].id);
    }

    const parsed = extraction.value;

    if (
      typeof parsed.environmentId !== "string" ||
      typeof parsed.reason !== "string" ||
      typeof parsed.confidence !== "number"
    ) {
      return fallbackEnvironmentDecision("invalid_shape", input.environments[0].id);
    }

    const validEnvironment = input.environments.find((environment) => environment.id === parsed.environmentId);
    if (!validEnvironment) {
      return fallbackEnvironmentDecision("invalid_environment", input.environments[0].id);
    }

    return {
      environmentId: validEnvironment.id,
      reason: parsed.reason,
      confidence: clampConfidence(parsed.confidence),
      selectionSource: "llm",
      usedFallback: false
    };
  } catch {
    return fallbackEnvironmentDecision("llm_error", input.environments[0].id);
  }
}
