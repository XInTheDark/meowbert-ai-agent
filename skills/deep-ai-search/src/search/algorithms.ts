import { getHostname, normalizeUrlForDedupe } from '../util/url.js';
import { clamp } from '../util/numbers.js';
import { clamp01, scaleGeometricInt } from '../util/scaling.js';

export interface SearchInternalParams {
  variantCount: number;
  resultsPerQuery: number;
  returnCount: number;
  maxPerDomain: number;
  considerCount: number;
}

export function breadthToInternalParams(
  breadth: number,
  limits: {
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
  }
): SearchInternalParams {
  const t = clamp01(breadth / 10);

  const variantCount = clamp(scaleGeometricInt(1, limits.maxVariants, t, limits.scalingExponent), 1, limits.maxVariants);
  const resultsPerQueryMin = clamp(limits.resultsPerQueryMin, 1, limits.braveResultsPerQueryMax);
  const resultsPerQuery = clamp(
    scaleGeometricInt(resultsPerQueryMin, limits.braveResultsPerQueryMax, t, limits.scalingExponent),
    resultsPerQueryMin,
    limits.braveResultsPerQueryMax
  );
  const returnCount = clamp(
    scaleGeometricInt(limits.returnCountMin, limits.returnCountMax, t, limits.returnCountExponent ?? limits.scalingExponent),
    limits.returnCountMin,
    limits.returnCountMax
  );

  const minMaxPerDomain = clamp(limits.maxPerDomainAtMinBreadth ?? returnCount, 1, returnCount);
  const maxMaxPerDomain = clamp(limits.maxPerDomainAtMaxBreadth, minMaxPerDomain, returnCount);
  // At breadth=0, use minMaxPerDomain. At breadth=10, use maxMaxPerDomain. (Non-decreasing.)
  const maxPerDomain = clamp(
    scaleGeometricInt(minMaxPerDomain, maxMaxPerDomain, t, limits.diversityExponent),
    minMaxPerDomain,
    maxMaxPerDomain
  );

  const considerCount = clamp(
    Math.round(variantCount * resultsPerQuery * limits.considerMultiplier),
    1,
    limits.considerCountMax
  );

  return { variantCount, resultsPerQuery, returnCount, maxPerDomain, considerCount };
}

export function interleaveResults<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const maxLen = Math.max(0, ...lists.map(l => l.length));
  for (let i = 0; i < maxLen; i += 1) {
    for (const list of lists) {
      const item = list[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

export function dedupeByNormalizedUrl<T extends { url: string }>(items: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    let key: string;
    try {
      key = normalizeUrlForDedupe(item.url);
    } catch {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function selectDiverseResults<T extends { url: string }>(results: T[], count: number, maxPerDomain: number): T[] {
  if (results.length <= count) return results;

  const queues = new Map<string, T[]>();
  const domainOrder: string[] = [];

  for (const r of results) {
    const host = getHostname(r.url) ?? 'unknown';
    if (!queues.has(host)) {
      queues.set(host, []);
      domainOrder.push(host);
    }
    queues.get(host)!.push(r);
  }

  const picked: T[] = [];
  const pickedPerDomain = new Map<string, number>();

  while (picked.length < count) {
    let progressed = false;
    for (const domain of domainOrder) {
      if (picked.length >= count) break;
      const already = pickedPerDomain.get(domain) ?? 0;
      if (already >= maxPerDomain) continue;

      const q = queues.get(domain);
      const next = q?.shift();
      if (!next) continue;

      picked.push(next);
      pickedPerDomain.set(domain, already + 1);
      progressed = true;
    }

    if (!progressed) break;
  }

  if (picked.length >= count) return picked.slice(0, count);

  // If diversity constraints were too strict, fill remaining slots by original order.
  const pickedUrls = new Set(picked.map(r => normalizeUrlForDedupe(r.url)));
  for (const r of results) {
    if (picked.length >= count) break;
    const k = normalizeUrlForDedupe(r.url);
    if (pickedUrls.has(k)) continue;
    picked.push(r);
    pickedUrls.add(k);
  }
  return picked.slice(0, count);
}
