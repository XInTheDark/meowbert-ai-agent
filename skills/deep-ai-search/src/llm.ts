import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

import type { LlmModelConfig } from './config.js';
import { getResolvedApiKey } from './config.js';

export function createLanguageModel(config: LlmModelConfig): LanguageModel {
  switch (config.provider) {
    case 'openai': {
      const provider = createOpenAI({
        apiKey: getResolvedApiKey(config),
        baseURL: config.baseURL,
        headers: config.headers,
        name: config.name
      });
      return provider(config.model);
    }
    case 'anthropic': {
      const provider = createAnthropic({
        apiKey: getResolvedApiKey(config),
        baseURL: config.baseURL,
        headers: config.headers,
        name: config.name
      });
      return provider(config.model);
    }
  }
}
