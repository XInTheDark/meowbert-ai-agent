import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { DeepAiSearchConfig } from '../config.js';
import { createLanguageModel } from '../llm.js';
import type { Logger } from '../logger.js';
import { braveWebSearch } from '../brave.js';
import { chunkArray, mapConcurrent } from '../util/batch.js';
import { domainMatches, getHostname } from '../util/url.js';
import { breadthToInternalParams, dedupeByNormalizedUrl, interleaveResults, selectDiverseResults } from '../search/algorithms.js';
import { generateObjectWithSchema } from '../ai/structured.js';
import { sanitizeMcpContentForIoLog, writeIoLog } from '../io-log.js';
import { TOOL_INSTRUCTIONS } from '../instructions.js';

export type SearchToolInput = {
  query: string;
  breadth?: number;
  domain_allowlist?: string[];
  domain_blocklist?: string[];
  brave_params?: Record<string, string | number | boolean>;
};

const SearchResultSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  snippet: z.string().optional(),
  domain: z.string().optional(),
  sourceQuery: z.string().optional()
});

const SearchToolOutputSchema = {
  query: z.string(),
  breadth: z.number(),
  variants: z.array(z.string()),
  results: z.array(SearchResultSchema)
};

type SearchToolOutput = z.infer<z.ZodObject<typeof SearchToolOutputSchema>>;
type SearchCandidate = { title?: string; url: string; snippet?: string; sourceQuery: string };
export type SearchToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: SearchToolOutput;
};

const RELEVANCE_FILTER_MIN_EXTRA_RESULTS = 5;

async function generateQueryVariants(
  query: string,
  variantCount: number,
  config: DeepAiSearchConfig,
  logger: Logger
): Promise<string[]> {
  if (variantCount <= 1) return [query];

  const smallModel = createLanguageModel(config.llm.small);
  const n = variantCount - 1;

  const schema = z.object({
    // Be tolerant: models sometimes return fewer than requested; we'll just use what we get.
    queries: z.array(z.string().min(1)).min(1).max(n)
  });

  let object: z.infer<typeof schema>;
  try {
    object = await generateObjectWithSchema({
      label: 'search.queryVariants',
      model: smallModel,
      temperature: config.llm.small.temperature,
      maxRetries: config.llm.small.maxRetries,
      forceToolCall: config.llm.small.forceToolCall,
      schema,
      system: TOOL_INSTRUCTIONS.llm.search.queryVariants.system,
      prompt: TOOL_INSTRUCTIONS.llm.search.queryVariants.prompt({
        query,
        maxVariantsToGenerate: n,
        maxLen: config.search.queryVariantMaxLen
      })
    });
  } catch (err) {
    // Don't fail the whole tool if the LLM won't comply with the schema.
    logger.warn('Failed to generate query variants; falling back to original query', { error: String(err) });
    return [query];
  }

  const variants = [query, ...object.queries]
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => (s.length > config.search.queryVariantMaxLen ? s.slice(0, config.search.queryVariantMaxLen) : s));

  // Dedupe exact variants while preserving order.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const v of variants) {
    if (seen.has(v)) continue;
    seen.add(v);
    unique.push(v);
  }

  logger.debug('Generated query variants', { variantCount: unique.length });
  return unique.slice(0, variantCount);
}

async function searchBraveVariant(
  variant: string,
  resultsPerQuery: number,
  braveParams: Record<string, string | number | boolean>,
  config: DeepAiSearchConfig,
  logger: Logger
): Promise<SearchCandidate[]> {
  try {
    const results = await braveWebSearch(variant, { count: resultsPerQuery, params: braveParams }, config);
    return results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      sourceQuery: variant
    }));
  } catch (err) {
    // Don't fail the whole `search` tool if one Brave query variant hits rate limits or errors.
    // We'll just treat it as returning no results and continue with the other variants.
    logger.warn('Brave search failed for query variant', { error: String(err), variant });
    return [];
  }
}

function applyDomainFilters<T extends { url: string }>(
  results: T[],
  domainAllowlist: string[] | undefined,
  domainBlocklist: string[] | undefined
): T[] {
  const allow = domainAllowlist?.map(d => d.trim()).filter(Boolean);
  const block = domainBlocklist?.map(d => d.trim()).filter(Boolean);

  return results.filter(r => {
    const host = getHostname(r.url);
    if (!host) return false;
    if (allow?.length) {
      if (!allow.some(d => domainMatches(host, d))) return false;
    }
    if (block?.length) {
      if (block.some(d => domainMatches(host, d))) return false;
    }
    return true;
  });
}

function shouldRunRelevanceFilter(candidateCount: number, returnCount: number, breadth: number): boolean {
  if (candidateCount <= returnCount) return false;

  const t = Math.min(1, Math.max(0, breadth / 10));
  const surplusMultiplier = 2.5 - t;
  const threshold = Math.max(returnCount + RELEVANCE_FILTER_MIN_EXTRA_RESULTS, Math.ceil(returnCount * surplusMultiplier));
  return candidateCount > threshold;
}

async function smallModelFilterRelevant(
  query: string,
  candidates: Array<{ title?: string; url: string; snippet?: string }>,
  config: DeepAiSearchConfig,
  logger: Logger
): Promise<number[]> {
  if (candidates.length === 0) return [];

  const smallModel = createLanguageModel(config.llm.small);

  const batches = chunkArray(candidates, config.search.smallFilterBatchSize);
  const schema = z.object({
    // Be tolerant: sometimes models return indexes as strings.
    keep: z.array(z.coerce.number().int().min(0))
  });

  // Dispatch batch filter requests concurrently to reduce latency.
  // We still preserve deterministic output ordering by flattening results in batch order.
  const absoluteKeepByBatch = await mapConcurrent(
    batches,
    config.search.smallFilterMaxConcurrency,
    async (batch, batchIndex): Promise<number[]> => {
      const offset = batchIndex * config.search.smallFilterBatchSize;

      let object: z.infer<typeof schema>;
      try {
        object = await generateObjectWithSchema({
          label: 'search.relevanceFilter',
          model: smallModel,
          temperature: config.llm.small.temperature,
          maxRetries: config.llm.small.maxRetries,
          forceToolCall: config.llm.small.forceToolCall,
          schema,
          system: TOOL_INSTRUCTIONS.llm.search.relevanceFilter.system,
          prompt: TOOL_INSTRUCTIONS.llm.search.relevanceFilter.prompt({
            query,
            candidatesJson: JSON.stringify(
              batch.map((r, i) => ({
                index: i,
                title: r.title ?? '',
                url: r.url,
                snippet: r.snippet ?? ''
              })),
              null,
              2
            )
          })
        });
      } catch (err) {
        // If filtering fails, keep the whole batch rather than failing the tool.
        logger.warn('Relevance filter failed for a batch; keeping all results in the batch', {
          error: String(err),
          batchIndex,
          batchSize: batch.length
        });
        return batch.map((_r, i) => offset + i);
      }

      const absoluteKeep: number[] = [];
      for (const idx of object.keep) {
        const absolute = offset + idx;
        if (absolute < 0 || absolute >= candidates.length) continue;
        absoluteKeep.push(absolute);
      }
      return absoluteKeep;
    }
  );

  const keepIndexes = absoluteKeepByBatch.flat();

  // Dedupe while preserving order.
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const idx of keepIndexes) {
    if (seen.has(idx)) continue;
    seen.add(idx);
    unique.push(idx);
  }

  logger.debug('Small-model relevance filter', { in: candidates.length, kept: unique.length });
  return unique;
}

export function getSearchToolInputSchema(config: DeepAiSearchConfig) {
  return {
    query: z
      .string()
      .min(1)
      .describe(TOOL_INSTRUCTIONS.tools.search.inputs.query),
    breadth: z
      .number()
      .min(0)
      .max(10)
      .default(config.search.defaultBreadth)
      .describe(TOOL_INSTRUCTIONS.tools.search.inputs.breadth),
    domain_allowlist: z
      .array(z.string())
      .optional()
      .describe(TOOL_INSTRUCTIONS.tools.search.inputs.domain_allowlist),
    domain_blocklist: z.array(z.string()).optional().describe(TOOL_INSTRUCTIONS.tools.search.inputs.domain_blocklist),
    brave_params: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe(TOOL_INSTRUCTIONS.tools.search.inputs.brave_params)
  };
}

function getSearchToolDescription(config: DeepAiSearchConfig): string {
  if (!config.aiFeaturesEnabled) {
    return TOOL_INSTRUCTIONS.tools.search.descriptionWithoutAi;
  }
  return TOOL_INSTRUCTIONS.tools.search.description;
}

export function createSearchToolHandler(config: DeepAiSearchConfig, logger: Logger) {
  return async (input: SearchToolInput): Promise<SearchToolResponse> => {
    writeIoLog({ type: 'mcp.tool.request', tool: 'search', input });
    const breadth = input.breadth ?? config.search.defaultBreadth;

    const { variantCount, resultsPerQuery, returnCount, maxPerDomain, considerCount } = breadthToInternalParams(breadth, {
      maxVariants: config.search.maxVariants,
      resultsPerQueryMin: config.search.scaling.resultsPerQueryMin,
      braveResultsPerQueryMax: config.search.braveResultsPerQueryMax,
      returnCountMin: config.search.returnCountMin,
      returnCountMax: config.search.returnCountMax,
      returnCountExponent: config.search.scaling.returnCountExponent,
      considerCountMax: config.search.considerCountMax,
      considerMultiplier: config.search.scaling.considerMultiplier,
      scalingExponent: config.search.scaling.exponent,
      maxPerDomainAtMinBreadth: config.search.scaling.maxPerDomainAtMinBreadth,
      maxPerDomainAtMaxBreadth: config.search.scaling.maxPerDomainAtMaxBreadth,
      diversityExponent: config.search.scaling.diversityExponent
    });

    const braveParams = {
      ...(config.brave.defaultParams ?? {}),
      ...(input.brave_params ?? {})
    };

    const variants = config.aiFeaturesEnabled
      ? await generateQueryVariants(input.query, variantCount, config, logger)
      : [input.query];
    const lists = await mapConcurrent(variants, config.brave.maxConcurrency, variant =>
      searchBraveVariant(variant, resultsPerQuery, braveParams, config, logger)
    );

    const interleaved = interleaveResults(lists);
    const deduped = dedupeByNormalizedUrl(interleaved);

    const domainFiltered = applyDomainFilters(
      deduped,
      input.domain_allowlist ?? config.search.defaultDomainAllowlist,
      input.domain_blocklist ?? config.search.defaultDomainBlocklist
    );
    const candidates = domainFiltered.slice(0, considerCount);

    const filtered = config.aiFeaturesEnabled && shouldRunRelevanceFilter(candidates.length, returnCount, breadth)
      ? (await smallModelFilterRelevant(input.query, candidates, config, logger)).map(i => candidates[i]!).filter(Boolean)
      : candidates;

    const final = selectDiverseResults(filtered, returnCount, maxPerDomain).map(r => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      domain: getHostname(r.url) ?? undefined,
      sourceQuery: r.sourceQuery
    }));

    const structuredContent: SearchToolOutput = {
      query: input.query,
      breadth,
      variants,
      results: final
    };

    const content = [
      {
        type: 'text' as const,
        text: JSON.stringify(structuredContent, null, 2)
      }
    ];
    const response = { content, structuredContent };
    writeIoLog({
      type: 'mcp.tool.response',
      tool: 'search',
      structuredContent,
      content: sanitizeMcpContentForIoLog(content)
    });
    return response;
  };
}

export function registerSearchTool(server: McpServer, config: DeepAiSearchConfig, logger: Logger) {
  const SearchInputSchema = getSearchToolInputSchema(config);
  const handler = createSearchToolHandler(config, logger);

  server.registerTool(
    'search',
    {
      description: getSearchToolDescription(config),
      inputSchema: SearchInputSchema,
      outputSchema: SearchToolOutputSchema
    },
    handler
  );
}
