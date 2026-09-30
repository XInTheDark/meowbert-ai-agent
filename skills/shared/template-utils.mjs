import fs from "node:fs/promises";
import path from "node:path";
import { resolveTaskScopedUserPath } from "./task-path-utils.mjs";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&#47;/g, "/")
    .replace(/&nbsp;/g, " " );
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExtensions(extensions) {
  return [...new Set((extensions ?? []).map((entry) => `.${String(entry).replace(/^\./, "").toLowerCase()}`))];
}

function absoluteOutputPath(outputPath) {
  return resolveTaskScopedUserPath(outputPath);
}

function hasAllowedTemplateExtension(targetUrl, extensions) {
  try {
    const parsed = new URL(targetUrl);
    const pathname = parsed.pathname.toLowerCase();
    return extensions.some((extension) => pathname.endsWith(extension));
  } catch {
    return false;
  }
}

function normalizeDuckDuckGoHref(href) {
  if (!href) {
    return null;
  }

  const decodedHref = decodeHtmlEntities(href);
  try {
    const parsed = new URL(decodedHref, "https://duckduckgo.com");
    const redirect = parsed.searchParams.get("uddg");
    return redirect ? decodeURIComponent(redirect) : parsed.toString();
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": DEFAULT_USER_AGENT,
      accept: "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}`);
  }

  return {
    finalUrl: response.url,
    contentType: response.headers.get("content-type") ?? "",
    text: await response.text()
  };
}

export async function searchTemplateCatalog({ query, extensions, limit = 5 }) {
  const normalizedExtensions = normalizeExtensions(extensions);
  const trimmedQuery = String(query ?? "").trim();
  if (!trimmedQuery) {
    throw new Error("query is required.");
  }

  const searchTerms = `${trimmedQuery} ${normalizedExtensions.map((entry) => entry.slice(1)).join(" OR ")} template`;
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(searchTerms)}`;
  const { text } = await fetchText(searchUrl);

  const resultRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  const snippets = [];
  let snippetMatch;
  while ((snippetMatch = snippetRegex.exec(text)) !== null) {
    snippets.push(stripHtml(snippetMatch[1] || snippetMatch[2] || ""));
  }

  const results = [];
  const seen = new Set();
  let match;
  while ((match = resultRegex.exec(text)) !== null && results.length < Math.max(1, limit)) {
    const url = normalizeDuckDuckGoHref(match[1]);
    if (!url || seen.has(url)) {
      continue;
    }

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname.includes("duckduckgo.com")) {
        continue;
      }
    } catch {
      continue;
    }
    seen.add(url);

    const title = stripHtml(match[2]);
    const lowered = `${title} ${url}`.toLowerCase();
    if (!lowered.includes("template") && !normalizedExtensions.some((extension) => lowered.includes(extension))) {
      continue;
    }

    results.push({
      title,
      url,
      snippet: snippets[results.length] ?? "",
      looks_like_direct_download: hasAllowedTemplateExtension(url, normalizedExtensions)
    });
  }

  return {
    query: trimmedQuery,
    search_terms: searchTerms,
    results
  };
}

function extractTemplateLinksFromHtml(baseUrl, html, extensions) {
  const hrefRegex = /href=["']([^"']+)["']/gi;
  const links = [];
  const seen = new Set();
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = decodeHtmlEntities(match[1]);
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) {
      continue;
    }

    try {
      const resolved = new URL(href, baseUrl).toString();
      if (!hasAllowedTemplateExtension(resolved, extensions) || seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      links.push(resolved);
    } catch {
      // Ignore malformed links.
    }
  }

  return links;
}

async function fetchBinary(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": DEFAULT_USER_AGENT,
      accept: "application/octet-stream,*/*"
    },
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`Request failed with ${response.status} ${response.statusText}`);
  }

  return {
    finalUrl: response.url,
    contentType: response.headers.get("content-type") ?? "",
    contentDisposition: response.headers.get("content-disposition") ?? "",
    buffer: Buffer.from(await response.arrayBuffer())
  };
}

function filenameFromHeaders(contentDisposition, finalUrl) {
  const headerMatch = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(contentDisposition || "");
  if (headerMatch) {
    return decodeURIComponent(headerMatch[1] || headerMatch[2]);
  }

  try {
    const parsed = new URL(finalUrl);
    return path.basename(parsed.pathname);
  } catch {
    return path.basename(finalUrl);
  }
}

export async function fetchTemplateToPath({ url, outputPath, extensions, allowPageLinkDiscovery = true }) {
  const normalizedExtensions = normalizeExtensions(extensions);
  const trimmedUrl = String(url ?? "").trim();
  if (!trimmedUrl) {
    throw new Error("url is required.");
  }

  if (hasAllowedTemplateExtension(trimmedUrl, normalizedExtensions)) {
    const downloaded = await fetchBinary(trimmedUrl);
    const absolutePath = absoluteOutputPath(outputPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, downloaded.buffer);
    return {
      outputPath: absolutePath,
      sourceUrl: trimmedUrl,
      finalUrl: downloaded.finalUrl,
      contentType: downloaded.contentType,
      filename: filenameFromHeaders(downloaded.contentDisposition, downloaded.finalUrl),
      discoveredLinks: []
    };
  }

  const page = await fetchText(trimmedUrl);
  if (!allowPageLinkDiscovery || !page.contentType.toLowerCase().includes("text/html")) {
    throw new Error("URL does not point to a direct template file. Provide a .pptx/.potx/.docx/.dotx link or enable page discovery.");
  }

  const discoveredLinks = extractTemplateLinksFromHtml(page.finalUrl, page.text, normalizedExtensions);
  if (discoveredLinks.length === 0) {
    throw new Error("No downloadable template files were found on that page.");
  }

  const downloaded = await fetchBinary(discoveredLinks[0]);
  const absolutePath = absoluteOutputPath(outputPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, downloaded.buffer);

  return {
    outputPath: absolutePath,
    sourceUrl: trimmedUrl,
    finalUrl: downloaded.finalUrl,
    contentType: downloaded.contentType,
    filename: filenameFromHeaders(downloaded.contentDisposition, downloaded.finalUrl),
    discoveredLinks
  };
}
