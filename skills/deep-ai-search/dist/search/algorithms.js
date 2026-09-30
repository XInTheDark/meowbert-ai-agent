import { getHostname, normalizeUrlForDedupe } from '../util/url.js';
import { clamp } from '../util/numbers.js';
import { clamp01, scaleGeometricInt } from '../util/scaling.js';
export function breadthToInternalParams(breadth, limits) {
    const t = clamp01(breadth / 10);
    const variantCount = clamp(scaleGeometricInt(1, limits.maxVariants, t, limits.scalingExponent), 1, limits.maxVariants);
    const resultsPerQueryMin = clamp(limits.resultsPerQueryMin, 1, limits.braveResultsPerQueryMax);
    const resultsPerQuery = clamp(scaleGeometricInt(resultsPerQueryMin, limits.braveResultsPerQueryMax, t, limits.scalingExponent), resultsPerQueryMin, limits.braveResultsPerQueryMax);
    const returnCount = clamp(scaleGeometricInt(limits.returnCountMin, limits.returnCountMax, t, limits.returnCountExponent ?? limits.scalingExponent), limits.returnCountMin, limits.returnCountMax);
    const minMaxPerDomain = clamp(limits.maxPerDomainAtMinBreadth ?? returnCount, 1, returnCount);
    const maxMaxPerDomain = clamp(limits.maxPerDomainAtMaxBreadth, minMaxPerDomain, returnCount);
    // At breadth=0, use minMaxPerDomain. At breadth=10, use maxMaxPerDomain. (Non-decreasing.)
    const maxPerDomain = clamp(scaleGeometricInt(minMaxPerDomain, maxMaxPerDomain, t, limits.diversityExponent), minMaxPerDomain, maxMaxPerDomain);
    const considerCount = clamp(Math.round(variantCount * resultsPerQuery * limits.considerMultiplier), 1, limits.considerCountMax);
    return { variantCount, resultsPerQuery, returnCount, maxPerDomain, considerCount };
}
export function interleaveResults(lists) {
    const out = [];
    const maxLen = Math.max(0, ...lists.map(l => l.length));
    for (let i = 0; i < maxLen; i += 1) {
        for (const list of lists) {
            const item = list[i];
            if (item !== undefined)
                out.push(item);
        }
    }
    return out;
}
export function dedupeByNormalizedUrl(items) {
    const out = [];
    const seen = new Set();
    for (const item of items) {
        let key;
        try {
            key = normalizeUrlForDedupe(item.url);
        }
        catch {
            continue;
        }
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}
export function selectDiverseResults(results, count, maxPerDomain) {
    if (results.length <= count)
        return results;
    const queues = new Map();
    const domainOrder = [];
    for (const r of results) {
        const host = getHostname(r.url) ?? 'unknown';
        if (!queues.has(host)) {
            queues.set(host, []);
            domainOrder.push(host);
        }
        queues.get(host).push(r);
    }
    const picked = [];
    const pickedPerDomain = new Map();
    while (picked.length < count) {
        let progressed = false;
        for (const domain of domainOrder) {
            if (picked.length >= count)
                break;
            const already = pickedPerDomain.get(domain) ?? 0;
            if (already >= maxPerDomain)
                continue;
            const q = queues.get(domain);
            const next = q?.shift();
            if (!next)
                continue;
            picked.push(next);
            pickedPerDomain.set(domain, already + 1);
            progressed = true;
        }
        if (!progressed)
            break;
    }
    if (picked.length >= count)
        return picked.slice(0, count);
    // If diversity constraints were too strict, fill remaining slots by original order.
    const pickedUrls = new Set(picked.map(r => normalizeUrlForDedupe(r.url)));
    for (const r of results) {
        if (picked.length >= count)
            break;
        const k = normalizeUrlForDedupe(r.url);
        if (pickedUrls.has(k))
            continue;
        picked.push(r);
        pickedUrls.add(k);
    }
    return picked.slice(0, count);
}
//# sourceMappingURL=algorithms.js.map