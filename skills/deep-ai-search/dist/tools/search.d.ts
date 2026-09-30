import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeepAiSearchConfig } from '../config.js';
import type { Logger } from '../logger.js';
export type SearchToolInput = {
    query: string;
    breadth?: number;
    domain_allowlist?: string[];
    domain_blocklist?: string[];
    brave_params?: Record<string, string | number | boolean>;
};
declare const SearchToolOutputSchema: {
    query: z.ZodString;
    breadth: z.ZodNumber;
    variants: z.ZodArray<z.ZodString>;
    results: z.ZodArray<z.ZodObject<{
        url: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        snippet: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        sourceQuery: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
};
type SearchToolOutput = z.infer<z.ZodObject<typeof SearchToolOutputSchema>>;
export type SearchToolResponse = {
    content: Array<{
        type: 'text';
        text: string;
    }>;
    structuredContent: SearchToolOutput;
};
export declare function getSearchToolInputSchema(config: DeepAiSearchConfig): {
    query: z.ZodString;
    breadth: z.ZodDefault<z.ZodNumber>;
    domain_allowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
    domain_blocklist: z.ZodOptional<z.ZodArray<z.ZodString>>;
    brave_params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
};
export declare function createSearchToolHandler(config: DeepAiSearchConfig, logger: Logger): (input: SearchToolInput) => Promise<SearchToolResponse>;
export declare function registerSearchTool(server: McpServer, config: DeepAiSearchConfig, logger: Logger): void;
export {};
