import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { getResolvedApiKey } from './config.js';
export function createLanguageModel(config) {
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
//# sourceMappingURL=llm.js.map