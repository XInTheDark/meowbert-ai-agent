import { isSkillEnabledByConfig } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import type { TaskMessageToolOptions } from "../tasks/task-service/index.js";

export interface ConnectorToolOptionsConfig {
  webSearch: boolean;
  memorySearch: boolean;
  scheduleTask: boolean;
  subtasks: boolean;
  computerUse: boolean;
  enabledSkills: string[];
  enabledSources: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildDefaultConnectorToolOptionsConfig(memoryEnabled: boolean): ConnectorToolOptionsConfig {
  return {
    webSearch: true,
    memorySearch: memoryEnabled,
    scheduleTask: true,
    subtasks: false,
    computerUse: false,
    enabledSkills: [],
    enabledSources: []
  };
}

export function normalizeConnectorToolOptionsConfig(
  input: unknown,
  memoryEnabled: boolean
): ConnectorToolOptionsConfig {
  const defaults = buildDefaultConnectorToolOptionsConfig(memoryEnabled);
  if (!isPlainObject(input)) {
    return defaults;
  }

  const enabledSkills = Array.isArray(input.enabledSkills)
    ? Array.from(
        new Set(
          input.enabledSkills.filter(
            (skill): skill is string =>
              typeof skill === "string"
              && skill.trim().length > 0
              && isSkillEnabledByConfig(config, skill.trim())
          )
        )
      )
    : defaults.enabledSkills;

  const enabledSources = Array.isArray(input.enabledSources)
    ? Array.from(
        new Set(
          input.enabledSources.filter(
            (source): source is string => typeof source === "string" && source.trim().length > 0
          )
        )
      )
    : defaults.enabledSources;

  return {
    webSearch: typeof input.webSearch === "boolean" ? input.webSearch : defaults.webSearch,
    memorySearch: memoryEnabled && (typeof input.memorySearch === "boolean" ? input.memorySearch : defaults.memorySearch),
    scheduleTask: typeof input.scheduleTask === "boolean" ? input.scheduleTask : defaults.scheduleTask,
    subtasks: typeof input.subtasks === "boolean" ? input.subtasks : defaults.subtasks,
    computerUse: false,
    enabledSkills,
    enabledSources
  };
}

export function buildTaskToolOptionsFromConnectorConfig(
  input: unknown,
  memoryEnabled: boolean
): TaskMessageToolOptions {
  const normalized = normalizeConnectorToolOptionsConfig(input, memoryEnabled);
  return {
    ...(normalized.webSearch ? { webSearch: true } : {}),
    ...(normalized.memorySearch ? { memorySearch: true } : {}),
    ...(normalized.scheduleTask ? { scheduleTask: true } : {}),
    ...(normalized.subtasks ? { subtasks: true } : {}),
    ...(normalized.computerUse ? { computerUse: true } : {}),
    ...(normalized.enabledSkills.length > 0 ? { enabledSkills: normalized.enabledSkills } : {}),
    ...(normalized.enabledSources.length > 0 ? { enabledSources: normalized.enabledSources } : {})
  };
}
