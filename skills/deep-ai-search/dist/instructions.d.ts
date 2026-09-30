/**
 * Central place for all tool descriptions + LLM prompt strings.
 *
 * Goal: make it easy to tweak wording without spelunking through tool code.
 *
 * Note: some entries are functions because they include dynamic values like counts
 * and JSON payloads.
 */
export declare const TOOL_INSTRUCTIONS: {
    readonly tools: {
        readonly search: {
            readonly description: "AI-powered web search tool.\n\n        Notes:\n        - Avoid duplicate or almost-duplicate queries. Instead, for more comprehensive results, just use a higher \"breadth\" parameter. The tool will take care of the specific query generation steps.\n        ";
            readonly descriptionWithoutAi: "Web search tool backed by Brave Search.\n\n        Notes:\n        - AI query expansion and AI relevance filtering are disabled by config.\n        - Use a clear, search-engine-friendly query.\n        ";
            readonly inputs: {
                readonly query: "The search query. For higher \"breadth\" values, you need to write a more detailed query for best results.";
                readonly breadth: "Range: 0-10. Higher breadth means broader exploration: it will return return a wider set of results with more sources, but takes longer. Lower breadth focuses on the most relevant results, faster.";
                readonly domain_allowlist: "(Optional) domain allowlist (e.g. [\"wikipedia.org\",\"github.com\"]).";
                readonly domain_blocklist: "(Optional) domain blocklist.";
                readonly brave_params: "(Optional) Additional Brave Search API query params (e.g. {\"freshness\":\"pw\",\"country\":\"US\",\"search_lang\":\"en\"}).";
            };
        };
        readonly fetch: {
            readonly description: "Fetch content from a URL. The URL can be a normal website or a file/image.";
            readonly descriptionWithoutAi: "Fetch raw extracted content from a URL. AI chunk selection and AI summarization are disabled by config.";
            readonly inputs: {
                readonly url: "URL to fetch.";
                readonly depth: "Range: 0-10. Higher depth means longer, deeper content returned, but takes longer.";
                readonly smart_mode: "If true (default), selects the most relevant chunks when the content is too long.";
                readonly ai_mode: "If true, additionally asks an LLM about the content based on \"prompt\".";
                readonly prompt: "Meaning depends on mode: \n          in smart_mode, \"prompt\" guides the selection criteria for relevant content;\n          in ai_mode, \"prompt\" is the instruction for summarization/extraction.";
            };
        };
    };
    readonly llm: {
        readonly search: {
            readonly queryVariants: {
                readonly system: "You generate web search query variants for the Brave Search API. Return only valid JSON that matches the schema.";
                readonly prompt: (args: {
                    query: string;
                    maxVariantsToGenerate: number;
                    maxLen: number;
                }) => string;
            };
            readonly relevanceFilter: {
                readonly system: "You filter web search results for relevance. Return only JSON matching the schema. Do not add commentary. Only use the provided results as context.";
                readonly prompt: (args: {
                    query: string;
                    candidatesJson: string;
                }) => string;
            };
        };
        readonly fetch: {
            readonly smartChunkSelect: {
                readonly system: "You select the most relevant text chunks from a document. Return only JSON matching the schema.";
                readonly prompt: (args: {
                    instruction: string;
                    desiredChunkCount: number;
                    maxIndex: number;
                    chunksJson: string;
                }) => string;
            };
            readonly aiMode: {
                readonly system: "Use ONLY the provided page content. Follow the user instruction. If the requested info is not present in the page content, say so explicitly (do not guess).";
                readonly prompt: (args: {
                    instruction: string;
                    pageText: string;
                }) => string;
            };
        };
    };
};
