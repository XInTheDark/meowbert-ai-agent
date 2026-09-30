import type { LanguageModel } from 'ai';
import * as z from 'zod/v4';
export declare function generateObjectWithSchema<TSchema extends z.ZodTypeAny>(args: {
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
}): Promise<z.infer<TSchema>>;
