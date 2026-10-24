import type { Response } from "openai/resources/responses/responses";

// Why the run calls the model. The gateway picks the model and the output limit for each purpose
// from the run's route, so an executor never chooses what it is billed for.
export type ModelCallPurpose = "turn" | "compaction" | "title" | "web_search";

export interface ModelGatewayRequest {
  purpose: ModelCallPurpose;
  // A Responses API request body without `model`.
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  // Session id for providers that resume upstream sessions (ChatGPT Codex).
  sessionId?: string;
  onEvent?: (event: unknown) => void;
  // Which try of the executor's own retry loop this is, for request logs.
  attempt?: number;
}

export interface ModelGatewayResult {
  response: Response;
  // What the response cost in weighted tokens; null when the provider reported no usage.
  weightedTokens: number | null;
}

// Every model call a run makes. The cloud worker calls the provider directly; other executors go
// through the control plane's model proxy, which holds the keys and settles usage.
export interface ModelGateway {
  create(request: ModelGatewayRequest): Promise<ModelGatewayResult>;
  // True when the run's subscription user has used up their allowance.
  isQuotaExceeded(): Promise<boolean>;
}
