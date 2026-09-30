import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { LRUCache } from 'lru-cache';
import { generateText } from 'ai';

import type { DeepAiSearchConfig } from '../config.js';
import { createLanguageModel } from '../llm.js';
import type { Logger } from '../logger.js';
import { generateObjectWithSchema } from '../ai/structured.js';
import { sanitizeMcpContentForIoLog, writeIoLog } from '../io-log.js';
import { TOOL_INSTRUCTIONS } from '../instructions.js';
import { clamp } from '../util/numbers.js';
import { sha256Base64Url } from '../util/hash.js';
import { normalizeUrlForDedupe } from '../util/url.js';
import { approxCharBudgetFromDepth, chunkTextByChars, truncateToChars } from '../util/text.js';
import { ChunkSelectionSchema, normalizeChunkSelection } from '../fetch/chunks.js';
import { clamp01, scaleGeometric } from '../util/scaling.js';
import { htmlToMarkdown } from '../fetch/html-to-markdown.js';
import { convertDownloadedFileToMarkdown, looksLikeHtmlDocument, sniffTextDownload } from '../fetch/file-conversion.js';

export type FetchToolInput = {
  url: string;
  depth?: number;
  smart_mode?: boolean;
  ai_mode?: boolean;
  prompt?: string;
};

const FetchToolOutputSchema = {
  url: z.string().url(),
  fetchedUrl: z.string().url().optional(),
  contentType: z.string().optional(),
  usedBrowser: z.boolean(),
  title: z.string().optional(),
  mode: z.enum(['text', 'image']),
  text: z.string().optional(),
  chars: z.number().int().optional(),
  maxChars: z.number().int().optional(),
  contentSha256: z.string().optional()
};

type FetchToolOutput = z.infer<z.ZodObject<typeof FetchToolOutputSchema>>;
export type FetchToolResponse = {
  content: Array<
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'image';
        mimeType: string;
        data: string;
      }
  >;
  structuredContent: FetchToolOutput;
};

type CachedFetch =
  | {
      kind: 'text';
      fetchedUrl: string;
      contentType?: string;
      title?: string;
      markdown: string;
      usedBrowser: boolean;
    }
  | {
      kind: 'image';
      fetchedUrl: string;
      contentType: string;
      dataBase64: string;
      usedBrowser: boolean;
    };

function createFetchCache(config: DeepAiSearchConfig) {
  return new LRUCache<string, CachedFetch>({
    max: config.fetch.cacheMaxEntries,
    ttl: config.fetch.cacheTtlMs
  });
}

async function readResponseBytes(res: Response, maxBytes: number): Promise<Uint8Array> {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new Error(`Response too large: ${buf.byteLength} bytes (limit ${maxBytes})`);
  }
  return buf;
}

function looksBlocked(status: number, contentType: string | undefined, bodySnippet: string): boolean {
  if ([401, 403, 406, 429, 503].includes(status)) return true;
  const ct = (contentType ?? '').toLowerCase();
  if (!ct.includes('text/html')) return false;
  const s = bodySnippet.toLowerCase();
  return (
    s.includes('captcha') ||
    s.includes('cloudflare') ||
    s.includes('access denied') ||
    s.includes('enable javascript') ||
    s.includes('verify you are human') ||
    s.includes('robot') ||
    s.includes('unusual traffic')
  );
}

async function fetchStatic(
  url: string,
  config: DeepAiSearchConfig
): Promise<{ fetchedUrl: string; contentType?: string; contentDisposition?: string; bytes: Uint8Array; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetch.httpTimeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': config.fetch.userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });

    const contentType = res.headers.get('content-type') ?? undefined;
    const contentDisposition = res.headers.get('content-disposition') ?? undefined;
    const bytes = await readResponseBytes(res, config.fetch.maxDownloadBytes);
    return { fetchedUrl: res.url || url, contentType, contentDisposition, bytes, status: res.status };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithBrowser(url: string, config: DeepAiSearchConfig, logger: Logger): Promise<{ fetchedUrl: string; contentType?: string; bytes: Uint8Array }> {
  // Puppeteer is optional. If it's not installed (or failed to install), we degrade gracefully.
  let puppeteerExtraMod: any;
  let stealthMod: any;
  try {
    puppeteerExtraMod = await import('puppeteer-extra');
    stealthMod = await import('puppeteer-extra-plugin-stealth');
  } catch (err) {
    throw new Error(`Browser fallback requested but puppeteer dependencies are missing: ${(err as Error).message}`);
  }

  const puppeteer = puppeteerExtraMod.default ?? puppeteerExtraMod;
  const stealthPluginFactory = stealthMod.default ?? stealthMod;
  puppeteer.use(stealthPluginFactory());

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    try {
      await page.setUserAgent(config.fetch.userAgent);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.fetch.browserNavigationTimeoutMs });
      const content = await page.content();
      const bytes = new TextEncoder().encode(content);
      if (bytes.byteLength > config.fetch.maxDownloadBytes) {
        throw new Error(`Browser-rendered HTML too large: ${bytes.byteLength} bytes (limit ${config.fetch.maxDownloadBytes})`);
      }
      return { fetchedUrl: page.url(), contentType: 'text/html; charset=utf-8', bytes };
    } finally {
      await page.close().catch((e: unknown) => logger.warn('Failed to close puppeteer page', { error: String(e) }));
    }
  } finally {
    await browser.close().catch((e: unknown) => logger.warn('Failed to close puppeteer browser', { error: String(e) }));
  }
}

function buildCacheKey(url: string): string {
  // Use a normalized URL so different tracking params don't explode the cache.
  try {
    return normalizeUrlForDedupe(url);
  } catch {
    return url;
  }
}

async function extractUrl(url: string, config: DeepAiSearchConfig, logger: Logger): Promise<CachedFetch> {
  const useBrowserFallback = config.fetch.enableBrowserFallback;

  // First attempt: static fetch.
  const first = await fetchStatic(url, config);
  const ct = first.contentType ?? '';
  const ctLower = ct.toLowerCase();
  const sniffedText = sniffTextDownload(first.bytes, ct);

  const isImage = ctLower.startsWith('image/');
  let isHtml =
    ctLower.includes('text/html') ||
    ctLower.includes('application/xhtml+xml') ||
    (sniffedText ? looksLikeHtmlDocument(sniffedText) : false);
  const isText = ctLower.startsWith('text/') || ctLower.includes('json') || ctLower.includes('xml');

  // If servers omit content-type, attempt a tiny sniff to avoid treating HTML as a "file".
  if (!ctLower && sniffedText && looksLikeHtmlDocument(sniffedText)) {
    isHtml = true;
  }

  if (isImage) {
    const dataBase64 = Buffer.from(first.bytes).toString('base64');
    return {
      kind: 'image',
      fetchedUrl: first.fetchedUrl,
      contentType: ct,
      dataBase64,
      usedBrowser: false
    };
  }

  if (isText && !isHtml) {
    return {
      kind: 'text',
      fetchedUrl: first.fetchedUrl,
      contentType: ct || 'text/plain; charset=utf-8',
      markdown: sniffedText ?? new TextDecoder('utf-8', { fatal: false }).decode(first.bytes),
      usedBrowser: false
    };
  }

  if (!isHtml && sniffedText && (!ctLower || ctLower === 'application/octet-stream' || ctLower === 'binary/octet-stream')) {
    return {
      kind: 'text',
      fetchedUrl: first.fetchedUrl,
      contentType: ct || 'text/plain; charset=utf-8',
      markdown: sniffedText,
      usedBrowser: false
    };
  }

  if (!isHtml) {
    const markdown = await convertDownloadedFileToMarkdown({
      sourceUrl: url,
      fetchedUrl: first.fetchedUrl,
      contentType: ct,
      contentDisposition: first.contentDisposition,
      bytes: first.bytes
    });
    return {
      kind: 'text',
      fetchedUrl: first.fetchedUrl,
      contentType: ct,
      markdown,
      usedBrowser: false
    };
  }

  const html = sniffedText ?? new TextDecoder('utf-8', { fatal: false }).decode(first.bytes);
  const blocked = looksBlocked(first.status, ct, html.slice(0, 4000));

  if (blocked && useBrowserFallback) {
    logger.info('Static fetch looks blocked; retrying with browser stealth', { url });
    const rendered = await fetchWithBrowser(url, config, logger);
    const html2 = new TextDecoder('utf-8', { fatal: false }).decode(rendered.bytes);
    const { title, markdown } = htmlToMarkdown(html2, rendered.fetchedUrl, {
      maxImageUrlsInMarkdown: config.fetch.maxImageUrlsInMarkdown
    });
    return {
      kind: 'text',
      fetchedUrl: rendered.fetchedUrl,
      contentType: rendered.contentType,
      title,
      markdown,
      usedBrowser: true
    };
  }

  const { title, markdown } = htmlToMarkdown(html, first.fetchedUrl, {
    maxImageUrlsInMarkdown: config.fetch.maxImageUrlsInMarkdown
  });
  return {
    kind: 'text',
    fetchedUrl: first.fetchedUrl,
    contentType: ct,
    title,
    markdown,
    usedBrowser: false
  };
}

async function smartSelectText(
  rawMarkdown: string,
  maxChars: number,
  prompt: string | undefined,
  config: DeepAiSearchConfig,
  logger: Logger
): Promise<string> {
  if (rawMarkdown.length <= maxChars) return rawMarkdown;

  const truncated = truncateToChars(rawMarkdown, config.fetch.smallModelContextChars);

  // Use a chunk size that scales with depth; smaller chunks for smaller budgets.
  const chunkSize = clamp(
    Math.round(maxChars / config.fetch.smartChunking.chunkSizeDivisor),
    config.fetch.smartChunking.minChunkChars,
    config.fetch.smartChunking.maxChunkChars
  );
  const overlap = clamp(
    Math.round(chunkSize * config.fetch.smartChunking.overlapRatio),
    0,
    Math.min(5000, chunkSize - 1)
  );
  const chunks = chunkTextByChars(truncated, chunkSize, overlap);

  const desiredChunkCount = clamp(Math.ceil(maxChars / chunkSize), 1, chunks.length);

  const smallModel = createLanguageModel(config.llm.small);

  const schema = z.object({
    selection: z.array(ChunkSelectionSchema)
  });

  let object: z.infer<typeof schema>;
  try {
    object = await generateObjectWithSchema({
      label: 'fetch.smartChunkSelect',
      model: smallModel,
      temperature: config.llm.small.temperature,
      maxRetries: config.llm.small.maxRetries,
      forceToolCall: config.llm.small.forceToolCall,
      schema,
      system: TOOL_INSTRUCTIONS.llm.fetch.smartChunkSelect.system,
      prompt: TOOL_INSTRUCTIONS.llm.fetch.smartChunkSelect.prompt({
        instruction: prompt ?? 'Select the most important and relevant chunks from the document.',
        desiredChunkCount,
        maxIndex: chunks.length - 1,
        chunksJson: JSON.stringify(
          chunks.map(c => ({ index: c.index, text: c.text })),
          null,
          2
        )
      })
    });
  } catch (err) {
    // If chunk selection fails, degrade to naive truncation rather than failing the entire fetch.
    logger.warn('Smart chunk selection failed; returning naive truncation instead', { error: String(err) });
    return truncateToChars(truncated, maxChars);
  }

  const pickedIdx = normalizeChunkSelection(object.selection, chunks.length);

  let assembled = '';
  for (const idx of pickedIdx) {
    const chunk = chunks[idx];
    if (!chunk) continue;
    if (assembled) assembled += '\n\n';
    assembled += chunk.text;
    if (assembled.length >= maxChars) break;
  }

  return truncateToChars(assembled, maxChars);
}

function maxCharsFromDepth(depth: number, config: DeepAiSearchConfig): number {
  const t = clamp01(depth / 10);
  const minChars = config.fetch.depthScaling.minChars;
  const maxChars = config.fetch.depthScaling.maxChars;
  const exponent = config.fetch.depthScaling.exponent;
  if (minChars > 0 && maxChars > 0) {
    const scaled = scaleGeometric(minChars, maxChars, t, exponent);
    return Math.round(scaled);
  }
  // Should be unreachable because schema enforces >0, but keep a fallback.
  return approxCharBudgetFromDepth(clamp(Math.round(depth), 0, 10));
}

export function getFetchToolInputSchema(config: DeepAiSearchConfig) {
  const baseSchema = {
    url: z.string().url().describe(TOOL_INSTRUCTIONS.tools.fetch.inputs.url),
    depth: z
      .number()
      .min(0)
      .max(10)
      .default(config.fetch.defaultDepth)
      .describe(TOOL_INSTRUCTIONS.tools.fetch.inputs.depth)
  };

  if (!config.aiFeaturesEnabled) {
    return baseSchema;
  }

  return {
    ...baseSchema,
    smart_mode: z
      .boolean()
      .default(config.fetch.defaultSmartMode)
      .describe(TOOL_INSTRUCTIONS.tools.fetch.inputs.smart_mode),
    ai_mode: z
      .boolean()
      .default(config.fetch.defaultAiMode)
      .describe(TOOL_INSTRUCTIONS.tools.fetch.inputs.ai_mode),
    prompt: z
      .string()
      .optional()
      .describe(TOOL_INSTRUCTIONS.tools.fetch.inputs.prompt)
  };
}

function getFetchToolDescription(config: DeepAiSearchConfig): string {
  if (!config.aiFeaturesEnabled) {
    return TOOL_INSTRUCTIONS.tools.fetch.descriptionWithoutAi;
  }
  return TOOL_INSTRUCTIONS.tools.fetch.description;
}

export function createFetchToolHandler(config: DeepAiSearchConfig, logger: Logger) {
  const cache = createFetchCache(config);

  return async (input: FetchToolInput): Promise<FetchToolResponse> => {
    writeIoLog({ type: 'mcp.tool.request', tool: 'fetch', input });
    const depth = input.depth ?? config.fetch.defaultDepth;
    const maxChars = maxCharsFromDepth(depth, config);

    const cacheKey = buildCacheKey(input.url);
    let cached = cache.get(cacheKey);
    let usedBrowser = cached?.usedBrowser ?? false;

    if (!cached) {
      cached = await extractUrl(input.url, config, logger);
      usedBrowser = cached.usedBrowser;
      cache.set(cacheKey, cached);
    }

    if (cached.kind === 'image') {
      const structuredContent: FetchToolOutput = {
        url: input.url,
        fetchedUrl: cached.fetchedUrl,
        contentType: cached.contentType,
        usedBrowser,
        mode: 'image'
      };

      const content = [
        {
          type: 'image' as const,
          mimeType: cached.contentType,
          data: cached.dataBase64
        }
      ];
      const response = { content, structuredContent };
      writeIoLog({
        type: 'mcp.tool.response',
        tool: 'fetch',
        structuredContent,
        content: sanitizeMcpContentForIoLog(content)
      });
      return response;
    }

    const rawMarkdown = cached.markdown;
    const useSmartMode = config.aiFeaturesEnabled && (input.smart_mode ?? config.fetch.defaultSmartMode);
    const smartText =
      useSmartMode && rawMarkdown.length > maxChars
        ? await smartSelectText(rawMarkdown, maxChars, input.prompt, config, logger)
        : truncateToChars(rawMarkdown, maxChars);

    let finalText = smartText;
    if (config.aiFeaturesEnabled && (input.ai_mode ?? config.fetch.defaultAiMode)) {
      const bigModel = createLanguageModel(config.llm.big);
      const system = TOOL_INSTRUCTIONS.llm.fetch.aiMode.system;
      const prompt = TOOL_INSTRUCTIONS.llm.fetch.aiMode.prompt({
        instruction: input.prompt ?? 'Summarize the page content.',
        pageText: smartText
      });

      // In ai_mode we want to reliably return a human-readable answer. Some OpenAI-compatible
      // providers/models are flaky with strict JSON-only structured output for long prompts,
      // so we use plain text generation here.
      try {
        writeIoLog({
          type: 'ai.request',
          label: 'fetch.aiModeText',
          system,
          prompt
        });
        const res = await generateText({
          model: bigModel,
          temperature: config.llm.big.temperature,
          maxRetries: config.llm.big.maxRetries,
          system,
          prompt
        });
        finalText = res.text.trim();
        writeIoLog({
          type: 'ai.response',
          label: 'fetch.aiModeText',
          text: finalText
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeIoLog({
          type: 'ai.error',
          label: 'fetch.aiModeText',
          error: message
        });
        // Don't fail the entire tool if ai_mode generation fails. Degrade to returning
        // the extracted content, which is still useful for downstream reasoning.
        logger.warn('AI mode failed; returning extracted text instead', { error: String(err) });
        finalText = smartText;
      }
    }

    const structuredContent: FetchToolOutput = {
      url: input.url,
      fetchedUrl: cached.fetchedUrl,
      contentType: cached.contentType,
      usedBrowser,
      title: cached.title,
      mode: 'text',
      text: finalText,
      chars: finalText.length,
      maxChars,
      contentSha256: sha256Base64Url(finalText)
    };

    const content = [
      {
        type: 'text' as const,
        text: finalText
      }
    ];
    const response = { content, structuredContent };
    writeIoLog({
      type: 'mcp.tool.response',
      tool: 'fetch',
      structuredContent,
      content: sanitizeMcpContentForIoLog(content)
    });
    return response;
  };
}

export function registerFetchTool(server: McpServer, config: DeepAiSearchConfig, logger: Logger) {
  const FetchInputSchema = getFetchToolInputSchema(config);
  const handler = createFetchToolHandler(config, logger);

  server.registerTool(
    'fetch',
    {
      description: getFetchToolDescription(config),
      inputSchema: FetchInputSchema,
      outputSchema: FetchToolOutputSchema
    },
    handler
  );
}
