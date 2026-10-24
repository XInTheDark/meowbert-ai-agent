import type { AppConfig } from "@meowbert/shared";

// Limits and paths that come from wherever the executor is deployed, not from the run.
export interface ExecutorSettings {
  maxSteps: number;
  commandTimeoutMs: number;
  maxCommandOutputKb: number;
  shell: string;
  sharedDependenciesDirectory?: string;
  // Optional image-owned skill assets, separate from the desktop's metadata catalog.
  sandboxSkillsRootDir?: string;
  sandboxPdfPreparation?: boolean;
  // Where bundled skills live and which optional ones are switched on.
  skills: AppConfig["skills"];
}

export function executorSettingsFromConfig(config: Pick<AppConfig, "runtime" | "skills">): ExecutorSettings {
  return {
    maxSteps: config.runtime.maxSteps,
    commandTimeoutMs: config.runtime.commandTimeoutMs,
    maxCommandOutputKb: config.runtime.maxCommandOutputKb,
    shell: config.runtime.shell,
    skills: config.skills
  };
}
