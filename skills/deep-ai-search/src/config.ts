import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';

import type { LogLevel } from './logger.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export type LlmProvider = 'openai' | 'anthropic';

export const LlmModelConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic']).default('openai'),
  model: z.string().min(1),
  /**
   * If provided, this wins over apiKeyEnvVar.
   * Prefer using env vars in production.
   */
  apiKey: z.string().min(1).optional(),
  /**
   * If provided and apiKey is not, we will read the key from process.env[apiKeyEnvVar].
   */
  apiKeyEnvVar: z.string().min(1).optional(),
  baseURL: z.string().url().optional(),
  /**
   * Extra headers to send to the provider (useful for proxies / custom gateways).
   */
  headers: z.record(z.string(), z.string()).optional(),
  /**
   * Provider name override (useful for OpenAI-compatible / proxied providers).
   */
  name: z.string().min(1).optional(),
  /**
   * Some OpenAI-compatible gateways do not reliably support "structured outputs"
   * via `response_format: { type: "json_schema", ... }`.
   *
   * When enabled, structured output calls will instead be implemented via
   * forced tool-calling with the schema used as the tool input schema.
   */
  forceToolCall: z.boolean().default(false),
  temperature: z.number().min(0).max(2).default(0),
  maxRetries: z.number().int().min(0).max(10).default(2)
});

export type LlmModelConfig = z.infer<typeof LlmModelConfigSchema>;

const DISABLED_LLM_MODEL_CONFIG = {
  provider: 'openai' as const,
  model: 'disabled',
  forceToolCall: false,
  temperature: 0,
  maxRetries: 0
};

export const DeepAiSearchConfigSchema = z.object({
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  aiFeaturesEnabled: z.boolean().default(true),
  /**
   * Optional JSONL file path for request/response logging (MCP tool calls, Brave, AI SDK).
   * This is separate from stderr logs.
   */
  logFile: z.string().min(1).optional(),
  brave: z.object({
    apiKeys: z.array(z.string().min(1)).min(1),
    baseUrl: z.string().url().default('https://api.search.brave.com/res/v1/web/search'),
    maxConcurrency: z.number().int().min(1).max(32).default(6),
    timeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
    defaultParams: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    retry: z.preprocess(
      v => v ?? {},
      z.object({
        maxRetries: z.number().int().min(0).max(10).default(4),
        initialBackoffMs: z.number().int().min(0).max(60_000).default(500),
        maxBackoffMs: z.number().int().min(0).max(10 * 60_000).default(30_000),
        respectRetryAfter: z.boolean().default(true)
      })
    )
  }),
  llm: z
    .object({
      big: LlmModelConfigSchema.default(DISABLED_LLM_MODEL_CONFIG),
      small: LlmModelConfigSchema.default(DISABLED_LLM_MODEL_CONFIG)
    })
    .default({
      big: DISABLED_LLM_MODEL_CONFIG,
      small: DISABLED_LLM_MODEL_CONFIG
    }),
  search: z.preprocess(
    v => v ?? {},
    z.object({
      defaultBreadth: z.number().min(0).max(10).default(4),
      returnCountMin: z.number().int().min(1).default(5),
      returnCountMax: z.number().int().min(1).default(50),
      considerCountMax: z.number().int().min(1).default(200),
      maxVariants: z.number().int().min(1).max(10).default(6),
      queryVariantMaxLen: z.number().int().min(20).max(300).default(120),
      braveResultsPerQueryMax: z.number().int().min(1).max(50).default(20),
      smallFilterBatchSize: z.number().int().min(5).max(200).default(50),
      /**
       * Max in-flight LLM requests for the batched small-model relevance filter.
       * (Higher values reduce latency but may increase provider rate limit errors.)
       */
      smallFilterMaxConcurrency: z.number().int().min(1).max(32).default(4),
      scaling: z.preprocess(
        v => v ?? {},
        z.object({
          /**
           * Shapes how quickly we ramp up with breadth. >1 grows slower at low breadth and faster at high breadth.
           */
          exponent: z.number().min(0.1).max(10).default(0.6),
          /**
           * Separate exponent for how quickly we ramp the final return count.
           * Defaults higher than `exponent` so we don't explode the default breadth,
           * while still allowing breadth=10 to return a lot more.
           */
          returnCountExponent: z.number().min(0.1).max(10).default(0.5),
          resultsPerQueryMin: z.number().int().min(1).max(50).default(10),
          /**
           * Considered websites = (variants * resultsPerQuery) * considerMultiplier, capped by considerCountMax.
           */
          considerMultiplier: z.number().min(0.5).max(5).default(1),
          /**
           * At breadth=0 we allow up to this many results per domain.
           * (This is a soft diversity control; if constraints are too strict, the selector will still fill remaining slots.)
           */
          maxPerDomainAtMinBreadth: z.number().int().min(1).default(5),
          /**
           * At breadth=10 we allow up to this many results per domain.
           */
          maxPerDomainAtMaxBreadth: z.number().int().min(1).default(10),
          /**
           * Shapes how quickly we change max-per-domain as breadth increases.
           * >1 = changes kick in later (more conservative at low breadth).
           */
          diversityExponent: z.number().min(0.1).max(10).default(1.0)
        })
      ),
      defaultDomainAllowlist: z.array(z.string()).default([]),
      defaultDomainBlocklist: z.array(z.string()).default([])
    })
  ),
  fetch: z.preprocess(
    v => v ?? {},
    z.object({
      defaultDepth: z.number().min(0).max(10).default(4),
      defaultSmartMode: z.boolean().default(true),
      defaultAiMode: z.boolean().default(false),
      cacheTtlMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).default(5 * 60 * 1000),
      cacheMaxEntries: z.number().int().min(1).max(10_000).default(128),
      userAgent: z.string().min(10).default(DEFAULT_USER_AGENT),
      httpTimeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
      maxDownloadBytes: z.number().int().min(100_000).max(100_000_000).default(10 * 1024 * 1024),
      enableBrowserFallback: z.boolean().default(true),
      browserNavigationTimeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
      smallModelContextChars: z.number().int().min(5000).max(500_000).default(60_000),
      /**
       * Limits how many `<img src="...">` URLs are preserved when converting HTML to Markdown.
       * After this threshold, images are rendered as a placeholder `[Image]` (no URL).
       */
      maxImageUrlsInMarkdown: z.number().int().min(0).max(10_000).default(10),
      depthScaling: z.preprocess(
        v => v ?? {},
        z.object({
          minChars: z.number().int().min(100).default(5000),
          maxChars: z.number().int().min(100).default(200_000),
          /**
           * Shapes how quickly we ramp up with depth. >1 grows slower at low depth and faster at high depth.
           */
          exponent: z.number().min(0.1).max(10).default(1.0)
        })
      ),
      smartChunking: z.preprocess(
        v => v ?? {},
        z.object({
          chunkSizeDivisor: z.number().int().min(2).max(50).default(8),
          minChunkChars: z.number().int().min(200).max(20_000).default(900),
          maxChunkChars: z.number().int().min(200).max(20_000).default(4000),
          overlapRatio: z.number().min(0).max(0.5).default(0.1)
        })
      )
    })
  )
});

export type DeepAiSearchConfig = z.infer<typeof DeepAiSearchConfigSchema>;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[K] extends Record<string, unknown>
      ? DeepPartial<T[K]>
      : T[K];
};

function splitCommaEnv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function expandEnvInString(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, envName: string) => {
    const envVal = process.env[envName];
    if (envVal === undefined) {
      throw new Error(`Config references env var ${envName} but it is not set.`);
    }
    return envVal;
  });
}

function expandEnvPlaceholders<T>(value: T): T {
  if (typeof value === 'string') return expandEnvInString(value) as T;
  if (Array.isArray(value)) return value.map(v => expandEnvPlaceholders(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandEnvPlaceholders(v);
    }
    return out as T;
  }
  return value;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function uniqStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = path.normalize(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function defaultApiKeyEnvVar(provider: LlmProvider): string {
  switch (provider) {
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
  }
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean environment value: ${value}`);
}

function resolveApiKey(model: LlmModelConfig): string | undefined {
  if (model.apiKey) return model.apiKey;
  const envVar = model.apiKeyEnvVar ?? defaultApiKeyEnvVar(model.provider);
  return process.env[envVar];
}

function applyEnvOverrides(base: DeepPartial<DeepAiSearchConfig>): DeepPartial<DeepAiSearchConfig> {
  const braveKeys = splitCommaEnv(process.env.BRAVE_API_KEYS) ?? (process.env.BRAVE_API_KEY ? [process.env.BRAVE_API_KEY] : undefined);

  const logLevel = process.env.DEEP_AI_SEARCH_LOG_LEVEL as LogLevel | undefined;
  const logFile = process.env.DEEP_AI_SEARCH_LOG_FILE;
  const aiFeaturesEnabled = parseBooleanEnv(process.env.DEEP_AI_SEARCH_AI_FEATURES_ENABLED);

  const bigProvider = process.env.DEEP_AI_SEARCH_BIG_PROVIDER as LlmProvider | undefined;
  const bigModel = process.env.DEEP_AI_SEARCH_BIG_MODEL;
  const bigApiKey = process.env.DEEP_AI_SEARCH_BIG_API_KEY;
  const bigApiKeyEnvVar = process.env.DEEP_AI_SEARCH_BIG_API_KEY_ENV;
  const bigBaseURL = process.env.DEEP_AI_SEARCH_BIG_BASE_URL;

  const smallProvider = process.env.DEEP_AI_SEARCH_SMALL_PROVIDER as LlmProvider | undefined;
  const smallModel = process.env.DEEP_AI_SEARCH_SMALL_MODEL;
  const smallApiKey = process.env.DEEP_AI_SEARCH_SMALL_API_KEY;
  const smallApiKeyEnvVar = process.env.DEEP_AI_SEARCH_SMALL_API_KEY_ENV;
  const smallBaseURL = process.env.DEEP_AI_SEARCH_SMALL_BASE_URL;

  const hasBigOverride = Boolean(base.llm?.big ?? bigProvider ?? bigModel ?? bigApiKey ?? bigApiKeyEnvVar ?? bigBaseURL);
  const hasSmallOverride = Boolean(base.llm?.small ?? smallProvider ?? smallModel ?? smallApiKey ?? smallApiKeyEnvVar ?? smallBaseURL);
  const llm =
    hasBigOverride || hasSmallOverride
      ? {
          ...(base.llm ?? {}),
          ...(hasBigOverride
            ? {
                big: {
                  ...(base.llm?.big ?? {}),
                  ...(bigProvider ? { provider: bigProvider } : null),
                  ...(bigModel ? { model: bigModel } : null),
                  ...(bigApiKey ? { apiKey: bigApiKey } : null),
                  ...(bigApiKeyEnvVar ? { apiKeyEnvVar: bigApiKeyEnvVar } : null),
                  ...(bigBaseURL ? { baseURL: bigBaseURL } : null)
                }
              }
            : null),
          ...(hasSmallOverride
            ? {
                small: {
                  ...(base.llm?.small ?? {}),
                  ...(smallProvider ? { provider: smallProvider } : null),
                  ...(smallModel ? { model: smallModel } : null),
                  ...(smallApiKey ? { apiKey: smallApiKey } : null),
                  ...(smallApiKeyEnvVar ? { apiKeyEnvVar: smallApiKeyEnvVar } : null),
                  ...(smallBaseURL ? { baseURL: smallBaseURL } : null)
                }
              }
            : null)
        }
      : undefined;

  return {
    ...base,
    logLevel: logLevel ?? base.logLevel,
    logFile: logFile ?? base.logFile,
    aiFeaturesEnabled: aiFeaturesEnabled ?? base.aiFeaturesEnabled,
    brave: {
      ...base.brave,
      apiKeys: braveKeys ?? base.brave?.apiKeys ?? [],
      baseUrl: process.env.BRAVE_API_BASE_URL ?? base.brave?.baseUrl,
      maxConcurrency: process.env.BRAVE_MAX_CONCURRENCY ? Number(process.env.BRAVE_MAX_CONCURRENCY) : base.brave?.maxConcurrency,
      timeoutMs: process.env.BRAVE_TIMEOUT_MS ? Number(process.env.BRAVE_TIMEOUT_MS) : base.brave?.timeoutMs
    },
    ...(llm ? { llm } : null)
  };
}

export async function loadConfig(): Promise<DeepAiSearchConfig> {
  const configPath = process.env.DEEP_AI_SEARCH_CONFIG_PATH;
  const configJson = process.env.DEEP_AI_SEARCH_CONFIG_JSON;

  let base: DeepPartial<DeepAiSearchConfig> = {};
  if (configPath) {
    const raw = await readFile(configPath, 'utf8');
    base = expandEnvPlaceholders(JSON.parse(raw) as DeepPartial<DeepAiSearchConfig>);
  } else if (configJson) {
    base = expandEnvPlaceholders(JSON.parse(configJson) as DeepPartial<DeepAiSearchConfig>);
  } else {
    // If no config path is provided, try conventional local config names.
    // NOTE: MCP hosts may start servers with a different cwd than you expect,
    // so we also look relative to the installed module location.
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));

    const candidates = uniqStrings([
      path.resolve(process.cwd(), 'deep-ai-search.config.json'),
      // If running from dist/, this resolves to the project/package root.
      path.resolve(moduleDir, '..', 'deep-ai-search.config.json'),
      // If someone places config next to the compiled JS files.
      path.resolve(moduleDir, 'deep-ai-search.config.json')
    ]);

    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        const raw = await readFile(candidate, 'utf8');
        base = expandEnvPlaceholders(JSON.parse(raw) as DeepPartial<DeepAiSearchConfig>);
        break;
      }
    }
  }

  const merged = applyEnvOverrides(base);
  const parsed = DeepAiSearchConfigSchema.parse(merged);

  if (parsed.aiFeaturesEnabled) {
    // Validate that LLM API keys exist (either explicit in config or via env).
    const bigKey = resolveApiKey(parsed.llm.big);
    const smallKey = resolveApiKey(parsed.llm.small);
    if (!bigKey) {
      const envVar = parsed.llm.big.apiKeyEnvVar ?? defaultApiKeyEnvVar(parsed.llm.big.provider);
      throw new Error(
        `Missing API key for big LLM. Set ${envVar} (recommended) or DEEP_AI_SEARCH_BIG_API_KEY / config.llm.big.apiKey.`
      );
    }
    if (!smallKey) {
      const envVar = parsed.llm.small.apiKeyEnvVar ?? defaultApiKeyEnvVar(parsed.llm.small.provider);
      throw new Error(
        `Missing API key for small LLM. Set ${envVar} (recommended) or DEEP_AI_SEARCH_SMALL_API_KEY / config.llm.small.apiKey.`
      );
    }
  }

  if (!parsed.brave.apiKeys?.length) {
    throw new Error('Missing Brave Search API key(s). Set BRAVE_API_KEY or BRAVE_API_KEYS.');
  }

  return parsed;
}

export function getResolvedApiKey(model: LlmModelConfig): string {
  const key = resolveApiKey(model);
  if (!key) {
    const envVar = model.apiKeyEnvVar ?? defaultApiKeyEnvVar(model.provider);
    throw new Error(`Missing API key for ${model.provider}. Set ${envVar} or provide apiKey/apiKeyEnvVar.`);
  }
  return key;
}
