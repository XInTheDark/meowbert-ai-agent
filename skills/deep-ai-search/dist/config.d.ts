import * as z from 'zod/v4';
export type LlmProvider = 'openai' | 'anthropic';
export declare const LlmModelConfigSchema: z.ZodObject<{
    provider: z.ZodDefault<z.ZodEnum<{
        openai: "openai";
        anthropic: "anthropic";
    }>>;
    model: z.ZodString;
    apiKey: z.ZodOptional<z.ZodString>;
    apiKeyEnvVar: z.ZodOptional<z.ZodString>;
    baseURL: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    name: z.ZodOptional<z.ZodString>;
    forceToolCall: z.ZodDefault<z.ZodBoolean>;
    temperature: z.ZodDefault<z.ZodNumber>;
    maxRetries: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type LlmModelConfig = z.infer<typeof LlmModelConfigSchema>;
export declare const DeepAiSearchConfigSchema: z.ZodObject<{
    logLevel: z.ZodDefault<z.ZodEnum<{
        debug: "debug";
        info: "info";
        warn: "warn";
        error: "error";
    }>>;
    aiFeaturesEnabled: z.ZodDefault<z.ZodBoolean>;
    logFile: z.ZodOptional<z.ZodString>;
    brave: z.ZodObject<{
        apiKeys: z.ZodArray<z.ZodString>;
        baseUrl: z.ZodDefault<z.ZodString>;
        maxConcurrency: z.ZodDefault<z.ZodNumber>;
        timeoutMs: z.ZodDefault<z.ZodNumber>;
        defaultParams: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
        retry: z.ZodPipe<z.ZodTransform<{}, unknown>, z.ZodObject<{
            maxRetries: z.ZodDefault<z.ZodNumber>;
            initialBackoffMs: z.ZodDefault<z.ZodNumber>;
            maxBackoffMs: z.ZodDefault<z.ZodNumber>;
            respectRetryAfter: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    llm: z.ZodDefault<z.ZodObject<{
        big: z.ZodDefault<z.ZodObject<{
            provider: z.ZodDefault<z.ZodEnum<{
                openai: "openai";
                anthropic: "anthropic";
            }>>;
            model: z.ZodString;
            apiKey: z.ZodOptional<z.ZodString>;
            apiKeyEnvVar: z.ZodOptional<z.ZodString>;
            baseURL: z.ZodOptional<z.ZodString>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            name: z.ZodOptional<z.ZodString>;
            forceToolCall: z.ZodDefault<z.ZodBoolean>;
            temperature: z.ZodDefault<z.ZodNumber>;
            maxRetries: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        small: z.ZodDefault<z.ZodObject<{
            provider: z.ZodDefault<z.ZodEnum<{
                openai: "openai";
                anthropic: "anthropic";
            }>>;
            model: z.ZodString;
            apiKey: z.ZodOptional<z.ZodString>;
            apiKeyEnvVar: z.ZodOptional<z.ZodString>;
            baseURL: z.ZodOptional<z.ZodString>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            name: z.ZodOptional<z.ZodString>;
            forceToolCall: z.ZodDefault<z.ZodBoolean>;
            temperature: z.ZodDefault<z.ZodNumber>;
            maxRetries: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    search: z.ZodPipe<z.ZodTransform<{}, unknown>, z.ZodObject<{
        defaultBreadth: z.ZodDefault<z.ZodNumber>;
        returnCountMin: z.ZodDefault<z.ZodNumber>;
        returnCountMax: z.ZodDefault<z.ZodNumber>;
        considerCountMax: z.ZodDefault<z.ZodNumber>;
        maxVariants: z.ZodDefault<z.ZodNumber>;
        queryVariantMaxLen: z.ZodDefault<z.ZodNumber>;
        braveResultsPerQueryMax: z.ZodDefault<z.ZodNumber>;
        smallFilterBatchSize: z.ZodDefault<z.ZodNumber>;
        smallFilterMaxConcurrency: z.ZodDefault<z.ZodNumber>;
        scaling: z.ZodPipe<z.ZodTransform<{}, unknown>, z.ZodObject<{
            exponent: z.ZodDefault<z.ZodNumber>;
            returnCountExponent: z.ZodDefault<z.ZodNumber>;
            resultsPerQueryMin: z.ZodDefault<z.ZodNumber>;
            considerMultiplier: z.ZodDefault<z.ZodNumber>;
            maxPerDomainAtMinBreadth: z.ZodDefault<z.ZodNumber>;
            maxPerDomainAtMaxBreadth: z.ZodDefault<z.ZodNumber>;
            diversityExponent: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        defaultDomainAllowlist: z.ZodDefault<z.ZodArray<z.ZodString>>;
        defaultDomainBlocklist: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    fetch: z.ZodPipe<z.ZodTransform<{}, unknown>, z.ZodObject<{
        defaultDepth: z.ZodDefault<z.ZodNumber>;
        defaultSmartMode: z.ZodDefault<z.ZodBoolean>;
        defaultAiMode: z.ZodDefault<z.ZodBoolean>;
        cacheTtlMs: z.ZodDefault<z.ZodNumber>;
        cacheMaxEntries: z.ZodDefault<z.ZodNumber>;
        userAgent: z.ZodDefault<z.ZodString>;
        httpTimeoutMs: z.ZodDefault<z.ZodNumber>;
        maxDownloadBytes: z.ZodDefault<z.ZodNumber>;
        enableBrowserFallback: z.ZodDefault<z.ZodBoolean>;
        browserNavigationTimeoutMs: z.ZodDefault<z.ZodNumber>;
        smallModelContextChars: z.ZodDefault<z.ZodNumber>;
        maxImageUrlsInMarkdown: z.ZodDefault<z.ZodNumber>;
        depthScaling: z.ZodPipe<z.ZodTransform<{}, unknown>, z.ZodObject<{
            minChars: z.ZodDefault<z.ZodNumber>;
            maxChars: z.ZodDefault<z.ZodNumber>;
            exponent: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        smartChunking: z.ZodPipe<z.ZodTransform<{}, unknown>, z.ZodObject<{
            chunkSizeDivisor: z.ZodDefault<z.ZodNumber>;
            minChunkChars: z.ZodDefault<z.ZodNumber>;
            maxChunkChars: z.ZodDefault<z.ZodNumber>;
            overlapRatio: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type DeepAiSearchConfig = z.infer<typeof DeepAiSearchConfigSchema>;
export declare function loadConfig(): Promise<DeepAiSearchConfig>;
export declare function getResolvedApiKey(model: LlmModelConfig): string;
