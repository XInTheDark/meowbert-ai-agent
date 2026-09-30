import type { RoutingDecision } from "./types.js";

export interface RoutingRule {
  id: string;
  priority: number;
  ruleType: "default_env" | "prefix_env" | "keyword_map" | "llm_fallback";
  ruleJson: Record<string, unknown>;
  enabled: boolean;
}

export interface EnvironmentCandidate {
  id: string;
  name: string;
}

export interface RoutingOptions {
  message: string;
  rules: RoutingRule[];
  environments: EnvironmentCandidate[];
}

export function routeWithRules(options: RoutingOptions): RoutingDecision | null {
  const sorted = [...options.rules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (rule.ruleType === "prefix_env") {
      const prefix = String(rule.ruleJson.prefix ?? "env:").trim();
      if (options.message.toLowerCase().startsWith(prefix.toLowerCase())) {
        const envName = options.message.slice(prefix.length).trim().split(" ")[0];
        const env = options.environments.find((candidate) => candidate.name.toLowerCase() === envName.toLowerCase());
        if (env) {
          return {
            environmentId: env.id,
            reason: `prefix:${prefix}`,
            confidence: 1,
            matchedRuleId: rule.id
          };
        }
      }
    }

    if (rule.ruleType === "keyword_map") {
      const map = rule.ruleJson.map;
      if (typeof map === "object" && map && !Array.isArray(map)) {
        for (const [keyword, envName] of Object.entries(map)) {
          if (options.message.toLowerCase().includes(keyword.toLowerCase())) {
            const env = options.environments.find(
              (candidate) => candidate.name.toLowerCase() === String(envName).toLowerCase()
            );
            if (env) {
              return {
                environmentId: env.id,
                reason: `keyword:${keyword}`,
                confidence: 0.95,
                matchedRuleId: rule.id
              };
            }
          }
        }
      }
    }

    if (rule.ruleType === "default_env") {
      const envId = String(rule.ruleJson.environmentId ?? "");
      if (envId) {
        const env = options.environments.find((candidate) => candidate.id === envId);
        if (env) {
          return {
            environmentId: env.id,
            reason: "default",
            confidence: 0.9,
            matchedRuleId: rule.id
          };
        }
      }
    }
  }

  return null;
}
