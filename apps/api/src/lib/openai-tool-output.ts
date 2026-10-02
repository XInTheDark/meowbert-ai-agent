import OpenAI from "openai";
import { streamResponseToFinal } from "@meowbert/shared";
import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem
} from "openai/resources/responses/responses";

interface ToolObjectExtractionInput {
  client: OpenAI;
  model: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  input: ResponseInputItem[];
  modelPayload?: Record<string, unknown>;
  onResponseUsage?: (usage: unknown) => Promise<void> | void;
}

export type ToolObjectExtractionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function isFunctionCallItem(item: ResponseOutputItem): item is ResponseFunctionToolCall {
  return item.type === "function_call";
}

export async function extractObjectWithToolCall<T>(
  input: ToolObjectExtractionInput
): Promise<ToolObjectExtractionResult<T>> {
  const tool: FunctionTool = {
    type: "function",
    name: input.toolName,
    description: input.toolDescription,
    strict: true,
    parameters: input.schema
  };

  const response = await streamResponseToFinal(input.client, {
    ...(input.modelPayload ?? {}),
    model: input.model,
    input: input.input,
    tools: [tool],
    tool_choice: {
      type: "function",
      name: input.toolName
    },
    parallel_tool_calls: false,
    store: false
  });
  await input.onResponseUsage?.(response.usage);

  if (response.error) {
    return { ok: false, error: response.error.message };
  }

  const toolCall = response.output.find(
    (item) => isFunctionCallItem(item) && item.name === input.toolName
  ) as ResponseFunctionToolCall | undefined;
  if (!toolCall) {
    return { ok: false, error: "Model did not return the expected tool call output" };
  }

  try {
    const parsed = JSON.parse(toolCall.arguments) as T;
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: "Model returned invalid JSON tool arguments" };
  }
}
