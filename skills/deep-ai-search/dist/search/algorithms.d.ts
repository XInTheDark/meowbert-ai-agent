export interface SearchInternalParams {
    variantCount: number;
    resultsPerQuery: number;
    returnCount: number;
    maxPerDomain: number;
    considerCount: number;
}
export declare function breadthToInternalParams(breadth: number, limits: {
    maxVariants: number;
    resultsPerQueryMin: number;
    braveResultsPerQueryMax: number;
    returnCountMin: number;
    returnCountMax: number;
    returnCountExponent?: number;
    considerCountMax: number;
    considerMultiplier: number;
    scalingExponent: number;
    maxPerDomainAtMinBreadth?: number;
    maxPerDomainAtMaxBreadth: number;
    diversityExponent: number;
}): SearchInternalParams;
export declare function interleaveResults<T>(lists: T[][]): T[];
export declare function dedupeByNormalizedUrl<T extends {
    url: string;
}>(items: T[]): T[];
export declare function selectDiverseResults<T extends {
    url: string;
}>(results: T[], count: number, maxPerDomain: number): T[];
