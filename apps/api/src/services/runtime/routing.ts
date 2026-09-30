import { routeWithRules } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { getPlatformAiClient } from "../platform/ai-provider-client.js";
import { getInternalModel } from "../admin/admin-settings.js";
import { extractObjectWithToolCall } from "../../lib/openai-tool-output.js";

const routingDecisionSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    environmentId: { type: "string" },
    reason: { type: "string" },
    confidence: { type: "number" }
  },
  required: ["environmentId", "reason", "confidence"]
};

export interface RoutingResult {
  environmentId: string;
  reason: string;
  confidence: number;
  matchedRuleId?: string;
}

export async function pickEnvironmentForConnector(workspaceId: string, message: string): Promise<RoutingResult> {
  const [rulesResult, environmentsResult] = await Promise.all([
    query<{
      id: string;
      priority: number;
      rule_type: "default_env" | "prefix_env" | "keyword_map" | "llm_fallback";
      rule_json: Record<string, unknown>;
      enabled: boolean;
    }>(
      `SELECT id, priority, rule_type, rule_json, enabled
         FROM routing_rules
        WHERE workspace_id = $1
        ORDER BY priority ASC`,
      [workspaceId]
    ),
    query<{ id: string; name: string }>(
      `SELECT id, name
         FROM environments
        WHERE workspace_id = $1
          AND status = 'active'`,
      [workspaceId]
    )
  ]);

  if ((environmentsResult.rowCount ?? 0) === 0) {
    throw new Error("No active environments available");
  }

  const ruleDecision = routeWithRules({
    message,
    rules: rulesResult.rows.map((row: {
      id: string;
      priority: number;
      rule_type: "default_env" | "prefix_env" | "keyword_map" | "llm_fallback";
      rule_json: Record<string, unknown>;
      enabled: boolean;
    }) => ({
      id: row.id,
      priority: row.priority,
      ruleType: row.rule_type,
      ruleJson: row.rule_json,
      enabled: row.enabled
    })),
    environments: environmentsResult.rows.map((row: { id: string; name: string }) => ({ id: row.id, name: row.name }))
  });

  if (ruleDecision) {
    return ruleDecision;
  }

  const openai = await getPlatformAiClient();
  if (!openai) {
    return {
      environmentId: environmentsResult.rows[0].id,
      reason: "fallback:first_environment",
      confidence: 0.25
    };
  }

  const envChoices = environmentsResult.rows.map((env) => ({ id: env.id, name: env.name }));

  const extraction = await extractObjectWithToolCall<RoutingResult>({
    client: openai,
    model: await getInternalModel(),
    toolName: "select_environment_routing",
    toolDescription: "Select the best environment for this message from the provided list.",
    schema: routingDecisionSchema,
    input: [
      {
        role: "developer",
        content:
          "Select the best environment for this message. confidence must be within [0,1]."
      },
      {
        role: "user",
        content: JSON.stringify({ message, environments: envChoices })
      }
    ]
  });

  const parsed = extraction.ok ? extraction.value : null;

  const fallback = environmentsResult.rows[0];

  if (!parsed) {
    return {
      environmentId: fallback.id,
      reason: extraction.ok ? "fallback:parse_failure" : `fallback:${extraction.error}`,
      confidence: 0.2
    };
  }

  const valid = environmentsResult.rows.find((env: { id: string; name: string }) => env.id === parsed.environmentId);
  if (!valid) {
    return {
      environmentId: fallback.id,
      reason: "fallback:invalid_environment",
      confidence: 0.2
    };
  }

  return parsed;
}
