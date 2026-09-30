import type { ApiClient } from "../lib/api";
import type { TaskAttachment, TaskThreadSummary, TaskToolOptions } from "../lib/types";
import type { SelectedTextQuote } from "../components/taskConversation/selectedTextQuoteUtils";

function buildThreadToolsPayload(
  toolOptions: TaskToolOptions,
  workspaceMemoryEnabled: boolean,
  allowComputerUse: boolean
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (toolOptions.webSearch) {
    payload.webSearch = true;
  }
  if (workspaceMemoryEnabled && toolOptions.memorySearch) {
    payload.memorySearch = true;
  }
  if (allowComputerUse && toolOptions.computerUse) {
    payload.computerUse = true;
  }
  if (toolOptions.enabledSkills.length > 0) {
    payload.enabledSkills = toolOptions.enabledSkills;
  }
  if (toolOptions.enabledSources.length > 0) {
    payload.enabledSources = toolOptions.enabledSources;
  }

  return payload;
}

export interface CreateTaskThreadInput {
  api: ApiClient;
  taskId: string;
  pendingThreadTaskId?: string | null;
  messageId: string;
  message: string;
  attachments: TaskAttachment[];
  selectedText?: SelectedTextQuote | null;
  toolOptions: TaskToolOptions;
  workspaceMemoryEnabled: boolean;
  allowComputerUse: boolean;
  selectedAgentId: string | null;
}

export interface CreateTaskThreadResponse {
  taskId: string;
  messageId: string;
  activeLeafMessageId: string;
  runId: string;
  attemptNo: number;
}

export async function listTaskThreads(api: ApiClient, taskId: string, parentMessageId: string): Promise<TaskThreadSummary[]> {
  const response = await api.get<{ items: TaskThreadSummary[] }>(
    `/api/tasks/${taskId}/threads?parentMessageId=${encodeURIComponent(parentMessageId)}`
  );

  return response.items;
}

export async function createTaskThread(input: CreateTaskThreadInput): Promise<CreateTaskThreadResponse> {
  const toolsPayload = buildThreadToolsPayload(
    input.toolOptions,
    input.workspaceMemoryEnabled,
    input.allowComputerUse
  );
  const hasTools = Object.keys(toolsPayload).length > 0;

  return input.api.post<CreateTaskThreadResponse>(`/api/tasks/${input.taskId}/threads`, {
    ...(input.pendingThreadTaskId ? { taskId: input.pendingThreadTaskId } : {}),
    messageId: input.messageId,
    message: input.message,
    attachments: input.attachments,
    ...(input.selectedText?.text.trim()
      ? {
          selectedText: input.selectedText.text.trim(),
          ...(input.selectedText.location ? { selectedTextLocation: input.selectedText.location } : {})
        }
      : {}),
    ...(hasTools ? { tools: toolsPayload } : {}),
    ...(input.selectedAgentId ? { agent: { id: input.selectedAgentId } } : {})
  });
}
