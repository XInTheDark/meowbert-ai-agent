const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAMS_EXACT = new Set([
    'gclid',
    'fbclid',
    'msclkid',
    'igshid',
    'mc_cid',
    'mc_eid',
    'ref',
    'ref_src'
]);
export function getHostname(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
export function normalizeUrlForDedupe(input) {
    const url = new URL(input);
    url.hash = '';
    url.username = '';
    url.password = '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    // Normalize default ports.
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
        url.port = '';
    }
    // Remove common tracking parameters.
    for (const key of [...url.searchParams.keys()]) {
        const lower = key.toLowerCase();
        if (TRACKING_PARAMS_EXACT.has(lower))
            url.searchParams.delete(key);
        if (TRACKING_PARAM_PREFIXES.some(prefix => lower.startsWith(prefix)))
            url.searchParams.delete(key);
    }
    // Sort params for stable equality.
    const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    url.search = '';
    for (const [k, v] of params)
        url.searchParams.append(k, v);
    // Normalize trailing slash (but keep root "/").
    if (url.pathname.endsWith('/') && url.pathname !== '/') {
        url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
}
export function domainMatches(hostname, domain) {
    const h = hostname.toLowerCase();
    const d = domain.toLowerCase();
    return h === d || h.endsWith(`.${d}`);
}
//# sourceMappingURL=url.js.map