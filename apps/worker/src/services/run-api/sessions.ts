import type { RunControl } from "@meowbert/run-executor/agent/ports/run-control";
import type { ModelCallPurpose, ModelGateway } from "@meowbert/run-executor/agent/ports/model-gateway";
import type { PlatformUsageBilling } from "@meowbert/shared";

// What the model proxy needs to know about a run to bill and bound its requests.
export interface RunModelPolicy {
  validateTools?: (tools: import("openai/resources/responses/responses").Tool[], purpose: string) => Promise<void>;
  requestUserId?: string | null;
  // Who the run's platform usage is billed to; null for runs on the user's own provider.
  billing: PlatformUsageBilling | null;
  quotaExempt: boolean;
  model(purpose: ModelCallPurpose): string;
  maxContextTokens: number;
  // The route's own request fields, which a request may repeat but not change.
  modelPayload: Record<string, unknown>;
  allowHostedWebSearch: boolean;
}

// A run whose executor reaches it over the Run API. The session lives in the worker that claimed
// the run; the API forwards the run's calls here.
export interface RunApiSession {
  fileHost?: import("@meowbert/shared").WorkspaceFileHost;
  runId: string;
  taskId: string;
  epoch: number;
  holder: string;
  control: RunControl;
  models: ModelGateway;
  policy(): RunModelPolicy;
  // The last message this run appended, which its next append must build on.
  leafMessageId: string | null;
  lastEventSeq: number;
  modelRequestInFlight: boolean;
  // Set once the run completed or failed; the session lingers so retried calls get their answers.
  finishedAt: number | null;
  storageWait?: boolean;
}

// How long a finished session answers retries of its last calls.
const FINISHED_SESSION_RETENTION_MS = 5 * 60 * 1000;

export class RunApiSessions {
  private readonly sessions = new Map<string, RunApiSession>();

  get(runId: string): RunApiSession | null {
    this.prune();
    return this.sessions.get(runId) ?? null;
  }

  add(session: RunApiSession): void {
    this.sessions.set(session.runId, session);
  }

  // Keeps answering retries for a while, then goes.
  markFinished(runId: string): void {
    const session = this.sessions.get(runId);
    if (session && session.finishedAt === null) session.finishedAt = Date.now();
  }

  remove(runId: string): void {
    this.sessions.delete(runId);
  }

  private prune(): void {
    const now = Date.now();
    for (const [runId, session] of this.sessions) {
      if (session.finishedAt !== null && now - session.finishedAt > FINISHED_SESSION_RETENTION_MS) {
        this.sessions.delete(runId);
      }
    }
  }
}
