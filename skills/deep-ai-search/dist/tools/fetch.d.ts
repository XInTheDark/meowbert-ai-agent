import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeepAiSearchConfig } from '../config.js';
import type { Logger } from '../logger.js';
export type FetchToolInput = {
    url: string;
    depth?: number;
    smart_mode?: boolean;
    ai_mode?: boolean;
    prompt?: string;
};
declare const FetchToolOutputSchema: {
    url: z.ZodString;
    fetchedUrl: z.ZodOptional<z.ZodString>;
    contentType: z.ZodOptional<z.ZodString>;
    usedBrowser: z.ZodBoolean;
    title: z.ZodOptional<z.ZodString>;
    mode: z.ZodEnum<{
        image: "image";
        text: "text";
    }>;
    text: z.ZodOptional<z.ZodString>;
    chars: z.ZodOptional<z.ZodNumber>;
    maxChars: z.ZodOptional<z.ZodNumber>;
    contentSha256: z.ZodOptional<z.ZodString>;
};
type FetchToolOutput = z.infer<z.ZodObject<typeof FetchToolOutputSchema>>;
export type FetchToolResponse = {
    content: Array<{
        type: 'text';
        text: string;
    } | {
        type: 'image';
        mimeType: string;
        data: string;
    }>;
    structuredContent: FetchToolOutput;
};
export declare function getFetchToolInputSchema(config: DeepAiSearchConfig): {
    url: z.ZodString;
    depth: z.ZodDefault<z.ZodNumber>;
} | {
    smart_mode: z.ZodDefault<z.ZodBoolean>;
    ai_mode: z.ZodDefault<z.ZodBoolean>;
    prompt: z.ZodOptional<z.ZodString>;
    url: z.ZodString;
    depth: z.ZodDefault<z.ZodNumber>;
};
export declare function createFetchToolHandler(config: DeepAiSearchConfig, logger: Logger): (input: FetchToolInput) => Promise<FetchToolResponse>;
export declare function registerFetchTool(server: McpServer, config: DeepAiSearchConfig, logger: Logger): void;
export {};
