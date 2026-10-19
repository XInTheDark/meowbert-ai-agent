// A model turn that produced nothing the run could use, so the loop nudged the model and asked again.
export type WastedTurnKind = "output_limit" | "reasoning_only" | "empty" | "plain_text";

export const WASTED_TURN_KIND_LABELS: Record<WastedTurnKind, string> = {
  output_limit: "Cut off at the output token limit",
  reasoning_only: "Reasoning only, no text or tool call",
  empty: "Empty turn",
  plain_text: "Plain text without a tool call"
};

export interface WastedTurnTotals {
  turns: number;
  weightedTokens: number;
}

export interface WastedTurnTaskBreakdown extends WastedTurnTotals {
  taskId: string;
  title: string | null;
}

export interface WastedTurnsReport {
  taskId: string;
  title: string | null;
  // Turn diagnostics are only logged while debug mode is on, so a run without them reports nothing.
  hasTurnDiagnostics: boolean;
  scopeTaskCount: number;
  allTurns: WastedTurnTotals;
  wasted: WastedTurnTotals & { unmeteredTurns: number };
  byKind: Array<WastedTurnTotals & { kind: WastedTurnKind }>;
  byTask: WastedTurnTaskBreakdown[];
}
