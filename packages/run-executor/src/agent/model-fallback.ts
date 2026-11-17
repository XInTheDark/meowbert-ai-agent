import type { AgentExecutionContext } from "./execution-types.js";
import { resetV2ContextWindow } from "./context-window.js";
import { isExhaustedModelRequest } from "./model-request-exhaustion.js";
import { appendRuntimeNotice, persistRuntimeNotices } from "./runtime-notices.js";
import { CODE_MODE_TOOLS_PROMPT_REASON } from "../code-mode/code-mode-prompt.js";

export async function activateFallbackModel(execution: AgentExecutionContext, error: unknown): Promise<boolean> {
  if (execution.state.contextManagement.version !== "v2" || !isExhaustedModelRequest(error)) return false;
  if (execution.runTiming.timedRunFinalizing) await execution.prepared.cancellationMonitor.assertNotCancelled();
  else await execution.assertRunNotAborted();
  const prepared = execution.prepared;
  const previousModel = prepared.runtimeModel;
  const route = await prepared.control.activateFallbackModel?.(previousModel);
  if (!route || route.model === previousModel) return false;
  prepared.runtimeModel = route.model;
  prepared.runtimeModelType = route.modelType;
  prepared.runtimeCompatibilityModes = route.compatibilityModes;
  prepared.runtimeEnvironmentPayload = route.environmentPayload;
  prepared.runtimeModelPayload = route.modelPayload;
  prepared.maxContextTokens = route.maxContextTokens;
  prepared.runtimeQuickModel = route.quickModel;
  prepared.runtimeQuickModelCompatibilityModes = route.quickModelCompatibilityModes;
  // A fork's frozen request belongs to the old model. Rebuild tools for this window.
  execution.laneSeed = null;
  await resetV2ContextWindow(execution, "model_fallback");
  // Code mode is resolved again for the target when the new turn's tools are built.
  execution.promptEnvelope.deltas = execution.promptEnvelope.deltas.filter((delta) => delta.reason !== CODE_MODE_TOOLS_PROMPT_REASON);
  appendRuntimeNotice(execution, {
    role: "system",
    content: `The previous model (${previousModel}) failed after its recovery attempts. You are the fallback model (${route.model}). Continue or complete the task using the retained context, notes, and history.`
  });
  await persistRuntimeNotices(execution);
  // A new model receives its own retry window; the run's hard deadline still applies.
  execution.state.modelFallbackCount = (execution.state.modelFallbackCount ?? 0) + 1;
  await prepared.control.emitEvent("log", {
    message: `Switching from ${previousModel} to fallback model ${route.model}.`,
    phase: "model_fallback", previousModel, model: route.model
  });
  return true;
}
