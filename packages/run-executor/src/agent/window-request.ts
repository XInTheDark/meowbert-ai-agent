import type { AgentExecutionContext } from "./execution-types.js";
import type { AgentTurnRequest } from "./turn-request.js";
import { isIdleCompactionRun } from "./idle-compaction.js";
import { appendPromptEnvelopeDelta, computePromptPrefixHash, getPromptEnvelopeRevision, promptEnvelopeToPrefixItems } from "./prompt-envelope.js";
import { buildPromptCacheKey } from "./turn-request.js";
import type { WindowRequestState } from "./window-request-types.js";
import { buildToolChangeNotice } from "./tool-change-notice.js";
import { needsNewToolDefinitions } from "./window-tool-freeze.js";
import type { ModelToolChoice } from "./model.js";

const SETUP_UPDATE = "[Current task setup]\n";
const TOOL_CHANGES_REASON = "tool-changes";
const preparedWindows = new WeakMap<AgentExecutionContext, string>();
const currentSetups = new WeakMap<AgentExecutionContext, WindowRequestState["envelope"]>();
const requestStates = new WeakMap<AgentExecutionContext, { windowId: string; signature: string; saved: WindowRequestState }>();

function setupText(envelope: WindowRequestState["envelope"]): string {
  return [...envelope.baseFrames, ...envelope.deltas].map(({ role, content }) =>
    "<" + role + ">\n" + content + "\n</" + role + ">").join("\n\n");
}

function latestSetupText(execution: AgentExecutionContext, original: string): string {
  for (const item of [...execution.state.dispatchState.conversationItems].reverse()) {
    const note = item as { role?: string; content?: unknown };
    if (note.role !== "developer" || typeof note.content !== "string" || !note.content.startsWith(SETUP_UPDATE)) continue;
    return note.content.slice(SETUP_UPDATE.length).replace(/\n\[id: [^\]]+\]$/, "");
  }
  return original;
}

function restoreEnvelope(execution: AgentExecutionContext, saved: WindowRequestState): void {
  const envelope = execution.promptEnvelope;
  envelope.baseVersion = saved.envelope.baseVersion;
  envelope.baseFrames = structuredClone(saved.envelope.baseFrames);
  envelope.deltas = structuredClone(saved.envelope.deltas);
  envelope.sealed = true;
}

// Saves the window's request recipe the first time, then keeps its tool definitions unless the run
// needs a tool they cannot offer. Idle compaction always replays what the last turn sent.
async function prepareStoredRequest(execution: AgentExecutionContext, candidate: WindowRequestState, idle: boolean): Promise<WindowRequestState> {
  const window = execution.state.contextManagement;
  if (window.version !== "v2") return candidate;
  const signature = JSON.stringify({ tools: candidate.tools, toolChoice: candidate.toolChoice });
  const cached = requestStates.get(execution);
  if (cached?.windowId === window.windowId && (idle || cached.signature === signature)) return cached.saved;
  const store = execution.prepared.control.context;
  let saved = await store.prepareWindowRequest(window, candidate, idle ? "replay" : "tool_choice");
  if (!idle && needsNewToolDefinitions(saved.tools, candidate.tools)) {
    saved = await store.prepareWindowRequest(window, candidate, "tools");
  }
  requestStates.set(execution, { windowId: window.windowId, signature, saved });
  return saved;
}

export async function prepareWindowTurnRequest(
  execution: AgentExecutionContext,
  turn: AgentTurnRequest,
  requestedToolChoice: ModelToolChoice = "auto"
): Promise<AgentTurnRequest & { toolChoice: ModelToolChoice }> {
  const window = execution.state.contextManagement;
  if (window.version !== "v2" || execution.laneSeed) return { ...turn, toolChoice: requestedToolChoice };
  const idle = isIdleCompactionRun(execution.job);
  const candidate: WindowRequestState = {
    envelope: structuredClone({ baseVersion: execution.promptEnvelope.baseVersion,
      baseFrames: execution.promptEnvelope.baseFrames, deltas: execution.promptEnvelope.deltas }),
    tools: { response: turn.responseTools, codeMode: turn.codeModeTools }, toolChoice: requestedToolChoice
  };
  const saved = await prepareStoredRequest(execution, candidate, idle);
  if (preparedWindows.get(execution) !== window.windowId) {
    currentSetups.set(execution, candidate.envelope);
    const currentSetup = setupText(candidate.envelope);
    const priorSetup = latestSetupText(execution, setupText(saved.envelope));
    restoreEnvelope(execution, saved);
    if (!idle && currentSetup !== priorSetup) appendPromptEnvelopeDelta(execution.promptEnvelope, {
      reason: "current-task-setup", role: "developer", content: SETUP_UPDATE + currentSetup
    });
    if (!idle && execution.state.dispatchState.conversationItems.some((item) => {
      const note = item as { content?: unknown };
      return typeof note.content === "string" && (note.content.startsWith("The timed task's deadline has been reached.")
        || note.content.startsWith("[System: The timed task's time limit has ended."));
    })) appendPromptEnvelopeDelta(execution.promptEnvelope, {
      reason: "current-run-state", role: "developer",
      content: "A new task run has started. Earlier timed wrap-up instructions have ended; follow the current task setup and available actions."
    });
    const toolChanges = idle ? null : buildToolChangeNotice(saved.tools,
      { response: turn.responseTools, codeMode: turn.codeModeTools }, execution.state.dispatchState.conversationItems);
    if (toolChanges) appendPromptEnvelopeDelta(execution.promptEnvelope, {
      reason: TOOL_CHANGES_REASON, role: "developer", content: toolChanges
    });
    preparedWindows.set(execution, window.windowId);
  }
  // The window's tool definitions go out unchanged; what this run may call is checked when it is called.
  const responseTools = saved.tools.response;
  const codeModeTools = turn.codeModeTools;
  const preferredToolChoice = idle ? saved.toolChoice ?? requestedToolChoice : requestedToolChoice;
  const toolChoice = typeof preferredToolChoice === "object" && !turn.availableResponseTools.some((tool) =>
    tool.type === "function" && tool.name === preferredToolChoice.name) ? "auto" : preferredToolChoice;
  const promptPrefixHash = computePromptPrefixHash({ envelope: execution.promptEnvelope, tools: responseTools });
  return { ...turn, responseTools, codeModeTools, toolChoice, promptPrefixHash,
    promptPrefixItems: promptEnvelopeToPrefixItems(execution.promptEnvelope),
    promptRevision: getPromptEnvelopeRevision(execution.promptEnvelope),
    promptCacheKey: buildPromptCacheKey(execution.swarm?.swarmTaskId ?? execution.job.taskId, promptPrefixHash),
    sessionAffinityKey: buildPromptCacheKey(execution.job.taskId, promptPrefixHash) };
}

// A rollover may adopt new setup; later resumes freeze that new window independently.
export function resetWindowRequestSetup(execution: AgentExecutionContext): void {
  const setup = currentSetups.get(execution);
  if (!setup) return;
  const envelope = execution.promptEnvelope;
  envelope.baseVersion = setup.baseVersion;
  envelope.baseFrames = structuredClone(setup.baseFrames);
  envelope.deltas = structuredClone(setup.deltas);
  for (const delta of envelope.conversationDeltas) {
    if (delta.reason === "current-task-setup" || delta.reason === "current-run-state" || delta.reason === TOOL_CHANGES_REASON) continue;
    if (!envelope.deltas.some((entry) => entry.role === delta.role && entry.content === delta.content)) {
      envelope.deltas.push(structuredClone(delta));
    }
  }
  envelope.conversationDeltas = [];
  envelope.drainedConversationDeltaCount = 0;
  envelope.sealed = false;
}
