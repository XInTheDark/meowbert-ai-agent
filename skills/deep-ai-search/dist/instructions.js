/**
 * Central place for all tool descriptions + LLM prompt strings.
 *
 * Goal: make it easy to tweak wording without spelunking through tool code.
 *
 * Note: some entries are functions because they include dynamic values like counts
 * and JSON payloads.
 */
export const TOOL_INSTRUCTIONS = {
    tools: {
        search: {
            description: `AI-powered web search tool.

        Notes:
        - Avoid duplicate or almost-duplicate queries. Instead, for more comprehensive results, just use a higher "breadth" parameter. The tool will take care of the specific query generation steps.
        `,
            descriptionWithoutAi: `Web search tool backed by Brave Search.

        Notes:
        - AI query expansion and AI relevance filtering are disabled by config.
        - Use a clear, search-engine-friendly query.
        `,
            inputs: {
                query: 'The search query. For higher "breadth" values, you need to write a more detailed query for best results.',
                breadth: `Range: 0-10. Higher breadth means broader exploration: it will return return a wider set of results with more sources, but takes longer. Lower breadth focuses on the most relevant results, faster.`,
                domain_allowlist: '(Optional) domain allowlist (e.g. ["wikipedia.org","github.com"]).',
                domain_blocklist: '(Optional) domain blocklist.',
                brave_params: '(Optional) Additional Brave Search API query params (e.g. {"freshness":"pw","country":"US","search_lang":"en"}).'
            }
        },
        fetch: {
            description: 'Fetch content from a URL. The URL can be a normal website or a file/image.',
            descriptionWithoutAi: 'Fetch raw extracted content from a URL. AI chunk selection and AI summarization are disabled by config.',
            inputs: {
                url: 'URL to fetch.',
                depth: 'Range: 0-10. Higher depth means longer, deeper content returned, but takes longer.',
                smart_mode: 'If true (default), selects the most relevant chunks when the content is too long.',
                ai_mode: 'If true, additionally asks an LLM about the content based on "prompt".',
                prompt: `Meaning depends on mode: 
          in smart_mode, "prompt" guides the selection criteria for relevant content;
          in ai_mode, "prompt" is the instruction for summarization/extraction.`
            }
        }
    },
    llm: {
        search: {
            queryVariants: {
                system: 'You generate web search query variants for the Brave Search API. Return only valid JSON that matches the schema.',
                prompt(args) {
                    return (`User query: ${args.query}

            Generate up to ${args.maxVariantsToGenerate} query variants that preserve the user's intent but explore slightly different angles / phrasings.
            Constraints:
            - Each query <= ${args.maxLen} characters
            - Keep it in a "search engine friendly" format (by default, no quotes or special characters)
            - Do not introduce unrelated topics
            - If the query contains technical terms, keep them
            - Small variations are good (synonyms, added qualifiers, re-ordered terms)
            - Avoid returning duplicate or almost-duplicate queries

            Return only the array of queries in JSON under key "queries".`);
                }
            },
            relevanceFilter: {
                system: 'You filter web search results for relevance. Return only JSON matching the schema. Do not add commentary. Only use the provided results as context.',
                prompt(args) {
                    return (`User query: ${args.query}
            
            Below are candidate results. Return the list of indexes (0-based) that are relevant to the query.
            Do not include items that are irrelevant or less than 60% relevant.
            
            ${args.candidatesJson}`);
                }
            }
        },
        fetch: {
            smartChunkSelect: {
                system: 'You select the most relevant text chunks from a document. Return only JSON matching the schema.',
                prompt(args) {
                    return (`Instruction: ${args.instruction}

            Select chunks to best satisfy the instruction.
            Rules:
            - Choose around ${args.desiredChunkCount} chunks (or ranges)
            - You may return individual chunk indexes or {start,end} ranges
            - Only use valid indexes from 0 to ${args.maxIndex}
            - Output in a coherent reading order (earlier to later)

            ${args.chunksJson}`);
                }
            },
            aiMode: {
                system: 'Use ONLY the provided page content. Follow the user instruction. If the requested info is not present in the page content, say so explicitly (do not guess).',
                prompt(args) {
                    return (`User instruction: ${args.instruction}

            --- BEGIN PAGE CONTENT ---
            ${args.pageText}
            --- END PAGE CONTENT ---`);
                }
            }
        }
    }
};
//# sourceMappingURL=instructions.js.map