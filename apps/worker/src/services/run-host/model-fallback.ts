import {
  resolveCompatibilityModesForModel,
  resolveContextManagementVersionForModel,
  resolveContextWindowForModel,
  resolveFallbackModelsForModel,
  resolveModelTypeForModel
} from "@meowbert/shared";
import { extractModelRequestPayload } from "@meowbert/run-executor/agent/utils";
import type { ServerRunState } from "./bootstrap.js";

// Only the admitted model's configured list can change a run's route. Keep the
// provider and workspace defaults, discarding the original preset/router payload.
export function createModelFallbackActivator(requireRun: () => ServerRunState) {
  let candidates: string[] | null = null;
  const attempted = new Set<string>();
  return async (currentModel: string) => {
    const run = requireRun();
    const { runtime } = run.bootstrap;
    if (runtime.requestedContextManagementVersion !== "v2") return null;
    if (currentModel !== runtime.model) return attempted.has(currentModel) ? runtime : null;
    const metadata = run.snapshot.platform_model_metadata;
    candidates ??= resolveFallbackModelsForModel(runtime.model, metadata);
    attempted.add(runtime.model);
    const model = candidates.find((candidate) => !attempted.has(candidate)
      && resolveContextManagementVersionForModel(candidate, metadata) === "v2");
    if (!model) return null;
    attempted.add(model);
    const environmentPayload = structuredClone(runtime.baseEnvironmentJsonPayload);
    const quickModel = runtime.providerKind === "platform"
      ? run.snapshot.platform_specialized_models?.fastModel ?? model
      : model;
    const next = {
      ...runtime,
      model,
      modelType: resolveModelTypeForModel(model, metadata),
      compatibilityModes: resolveCompatibilityModesForModel(model, metadata),
      maxContextTokens: resolveContextWindowForModel(model, metadata),
      quickModel,
      quickModelCompatibilityModes: resolveCompatibilityModesForModel(quickModel, metadata),
      environmentPayload,
      modelPayload: extractModelRequestPayload(environmentPayload)
    };
    run.bootstrap.runtime = next;
    return next;
  };
}
