import type { DeepAiSearchConfig } from './config.js';
export interface BraveWebResult {
    title?: string;
    url: string;
    description?: string;
    age?: string;
    language?: string;
}
export interface BraveSearchResponse {
    web?: {
        results?: BraveWebResult[];
    };
}
export interface BraveSearchOptions {
    count: number;
    params?: Record<string, string | number | boolean | undefined>;
}
export declare function braveWebSearch(query: string, options: BraveSearchOptions, config: DeepAiSearchConfig): Promise<BraveWebResult[]>;
