import { afterEach, describe, expect, it, vi } from 'vitest';

const { braveWebSearchMock, generateObjectWithSchemaMock } = vi.hoisted(() => ({
  braveWebSearchMock: vi.fn(),
  generateObjectWithSchemaMock: vi.fn()
}));

vi.mock('../../src/brave.js', () => ({
  braveWebSearch: braveWebSearchMock
}));

vi.mock('../../src/ai/structured.js', () => ({
  generateObjectWithSchema: generateObjectWithSchemaMock
}));

import { DeepAiSearchConfigSchema } from '../../src/config.js';
import { createSearchToolHandler } from '../../src/tools/search.js';

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
  }
});

function makeResults(query: string, count: number) {
  return Array.from({ length: count }, (_item, i) => ({
    title: `${query} result ${i}`,
    url: `https://example-${i}.com/${encodeURIComponent(query)}`,
    description: `${query} snippet ${i}`
  }));
}

describe('search tool', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('preserves an intentional empty relevance-filter result', async () => {
    braveWebSearchMock.mockImplementation(async (query: string) => makeResults(query, 50));
    generateObjectWithSchemaMock.mockImplementation(async (args: { label?: string }) => {
      if (args.label === 'search.queryVariants') {
        return { queries: ['unlikely query variant 1', 'unlikely query variant 2'] };
      }
      if (args.label === 'search.relevanceFilter') return { keep: [] };
      throw new Error(`Unexpected structured generation label: ${args.label ?? '<none>'}`);
    });

    const handler = createSearchToolHandler(config, logger);
    const result = await handler({
      query: 'unlikely query',
      breadth: 10
    });

    expect(result.structuredContent.results).toEqual([]);
    expect(generateObjectWithSchemaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'search.relevanceFilter'
      })
    );
  });

  it('searches all generated variants at normal breadth', async () => {
    braveWebSearchMock.mockImplementation(async (query: string) => makeResults(query, 15));
    generateObjectWithSchemaMock.mockImplementation(async (args: { label?: string }) => {
      if (args.label === 'search.queryVariants') {
        return { queries: ['base query alternate', 'base query docs'] };
      }
      throw new Error(`Unexpected structured generation label: ${args.label ?? '<none>'}`);
    });

    const handler = createSearchToolHandler(config, logger);
    const result = await handler({
      query: 'base query',
      breadth: 4
    });

    expect(result.structuredContent.variants).toEqual(['base query', 'base query alternate', 'base query docs']);
    expect(result.structuredContent.results).toHaveLength(21);
    expect(braveWebSearchMock).toHaveBeenCalledTimes(3);
    expect(generateObjectWithSchemaMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'search.relevanceFilter'
      })
    );
  });

  it('does not call AI generation when AI features are disabled', async () => {
    const noAiConfig = DeepAiSearchConfigSchema.parse({
      aiFeaturesEnabled: false,
      brave: { apiKeys: ['test-brave-key'] },
      search: {
        maxVariants: 6
      }
    });
    braveWebSearchMock.mockImplementation(async (query: string) => makeResults(query, 50));

    const handler = createSearchToolHandler(noAiConfig, logger);
    const result = await handler({
      query: 'plain brave query',
      breadth: 10
    });

    expect(result.structuredContent.variants).toEqual(['plain brave query']);
    expect(result.structuredContent.results.length).toBeGreaterThan(0);
    expect(braveWebSearchMock).toHaveBeenCalledTimes(1);
    expect(generateObjectWithSchemaMock).not.toHaveBeenCalled();
  });
});
