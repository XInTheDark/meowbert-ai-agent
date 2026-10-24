import type { CompactContextInput } from "../context-compaction/index.js";
import type { AgentExecutionContext } from "./execution-types.js";

type CompactionRunFields = Pick<
  CompactContextInput,
  | "control"
  | "models"
  | "supportsNativeCompaction"
  | "taskId"
  | "step"
  | "model"
  | "compactionBackend"
  | "requestTimeoutMs"
  | "abortSignal"
  | "maxContextTokens"
  | "platformModelMetadata"
  | "systemPrompt"
>;

// The run-level fields every compaction call takes.
export function buildCompactionRunFields(
  execution: AgentExecutionContext,
  step: number,
  abortSignal: AbortSignal
): CompactionRunFields {
  const { prepared } = execution;
  return {
    control: prepared.control,
    models: prepared.models,
    supportsNativeCompaction: prepared.supportsNativeCompaction,
    taskId: execution.job.taskId,
    step,
    model: prepared.runtimeModel,
    compactionBackend: prepared.snapshot.compaction_backend,
    requestTimeoutMs: prepared.snapshot.model_request_timeout_ms,
    abortSignal,
    maxContextTokens: prepared.maxContextTokens,
    platformModelMetadata: prepared.snapshot.platform_model_metadata,
    systemPrompt: execution.systemPrompt
  };
}
