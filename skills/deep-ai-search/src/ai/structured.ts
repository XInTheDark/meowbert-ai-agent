import type { LanguageModel } from 'ai';
import { generateObject, generateText } from 'ai';
import * as z from 'zod/v4';

import { writeIoLog } from '../io-log.js';

export async function generateObjectWithSchema<TSchema extends z.ZodTypeAny>(args: {
  model: LanguageModel;
  schema: TSchema;
  system?: string;
  prompt: string;
  temperature?: number;
  maxRetries?: number;
  label?: string;
  /**
   * If true, do not use structured outputs (`response_format: json_schema`).
   * Instead, force the model to "call" a synthetic tool whose input schema is
   * the desired output schema, and return the tool arguments.
   *
   * This is useful for OpenAI-compatible gateways that do not reliably support
   * OpenAI's structured outputs.
   */
  forceToolCall?: boolean;
}): Promise<z.infer<TSchema>> {
  const { model, schema, system, prompt, temperature, maxRetries, label, forceToolCall } = args;

  // We use the AI SDK's validated structured-output mechanisms only:
  // - Default: `generateObject` (response_format json_schema)
  // - Optional: forced tool calling (tool args validated against the schema)
  //
  // We intentionally do not implement custom JSON repair/parsing logic; callers should
  // handle failures by retrying or falling back to non-LLM behavior.
  try {
    writeIoLog({
      type: 'ai.request',
      label: label ?? 'generateObject',
      system: system ?? '',
      prompt,
      mode: forceToolCall ? 'toolCall' : 'structuredOutput'
    });

    if (forceToolCall) {
      const toolName = 'output';

      const res = await generateText({
        model,
        system,
        prompt,
        temperature,
        maxRetries,
        tools: {
          [toolName]: {
            description:
              'Return the response by calling this tool with an object that matches the provided schema. Do not write any text.',
            inputSchema: schema
          }
        },
        toolChoice: { type: 'tool', toolName }
      });

      const toolCall = res.toolCalls.find(c => c.toolName === toolName);
      if (!toolCall || toolCall.invalid) {
        const details = toolCall?.error ? ` toolError=${String(toolCall.error)}` : '';
        throw new Error(`Expected a valid tool call to "${toolName}" but did not get one.${details}`);
      }

      writeIoLog({
        type: 'ai.response',
        label: label ?? 'generateObject',
        mode: 'toolCall',
        object: toolCall.input
      });
      return toolCall.input as z.infer<TSchema>;
    }

    const { object } = await generateObject({ model, schema, system, prompt, temperature, maxRetries });
    // `ai`'s generateObject typing is based on its "FlexibleSchema" abstraction. When
    // using zod/v4 types, TS sometimes can't reconcile the inferred output type.
    // We still validate at runtime via AI SDK + Zod, so this cast is safe here.
    writeIoLog({
      type: 'ai.response',
      label: label ?? 'generateObject',
      mode: 'structuredOutput',
      object
    });
    return object as z.infer<TSchema>;
  } catch (err) {
    const prefix = label ? `${label}: ` : '';
    const message = err instanceof Error ? err.message : String(err);
    writeIoLog({
      type: 'ai.error',
      label: label ?? 'generateObject',
      error: message
    });
    throw new Error(`${prefix}${message}`);
  }
}
