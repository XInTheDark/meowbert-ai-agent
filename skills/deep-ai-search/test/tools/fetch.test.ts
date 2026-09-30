import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileMock, generateTextMock, generateObjectWithSchemaMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  generateTextMock: vi.fn(),
  generateObjectWithSchemaMock: vi.fn()
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock
}));

vi.mock('ai', () => ({
  generateText: generateTextMock
}));

vi.mock('../../src/ai/structured.js', () => ({
  generateObjectWithSchema: generateObjectWithSchemaMock
}));

import { DeepAiSearchConfigSchema } from '../../src/config.js';
import { createFetchToolHandler, getFetchToolInputSchema } from '../../src/tools/fetch.js';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

const config = DeepAiSearchConfigSchema.parse({
  brave: { apiKeys: ['test-brave-key'] },
  llm: {
    big: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test-openai-key' },
    small: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'test-openai-key' }
  },
  fetch: {
    defaultSmartMode: false,
    defaultAiMode: false
  }
});

describe('fetch tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    execFileMock.mockReset();
    generateTextMock.mockReset();
    generateObjectWithSchemaMock.mockReset();
  });

  it('returns text directly for octet-stream downloads that are actually text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('alpha\nbeta', {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream'
        }
      })
    );

    const handler = createFetchToolHandler(config, logger);
    const result = await handler({
      url: 'https://example.com/download',
      smart_mode: false
    });

    expect(result.structuredContent.mode).toBe('text');
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'alpha\nbeta'
      }
    ]);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('treats mislabeled html downloads as html instead of sending them to MarkItDown', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><head><title>Example</title></head><body><h1>Hello</h1><p>World</p></body></html>', {
        status: 200,
        headers: {
          'content-type': 'application/pdf'
        }
      })
    );

    const handler = createFetchToolHandler(config, logger);
    const result = await handler({
      url: 'https://example.com/fake.pdf',
      smart_mode: false
    });

    expect(result.structuredContent.mode).toBe('text');
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Hello')
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('hides and ignores AI fetch controls when AI features are disabled', async () => {
    const noAiConfig = DeepAiSearchConfigSchema.parse({
      aiFeaturesEnabled: false,
      brave: { apiKeys: ['test-brave-key'] },
      fetch: {
        defaultSmartMode: true,
        defaultAiMode: true,
        depthScaling: {
          minChars: 100,
          maxChars: 100
        }
      }
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('0123456789'.repeat(20), {
        status: 200,
        headers: {
          'content-type': 'text/plain'
        }
      })
    );

    expect(Object.keys(getFetchToolInputSchema(noAiConfig))).toEqual(['url', 'depth']);

    const handler = createFetchToolHandler(noAiConfig, logger);
    const result = await handler({
      url: 'https://example.com/plain.txt',
      smart_mode: true,
      ai_mode: true,
      prompt: 'summarize this'
    });

    expect(result.structuredContent.text).toBe('0123456789'.repeat(10));
    expect(generateObjectWithSchemaMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});
