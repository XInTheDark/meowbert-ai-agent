import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
function escapeAltText(text) {
    // Minimal escaping so we don't break the `![alt](url)` syntax.
    return text.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]').replace(/\s+/g, ' ').trim();
}
function createTurndown(options) {
    const turndown = new TurndownService({
        codeBlockStyle: 'fenced'
    });
    // Important: keep this as a per-conversion counter so the limit applies to each page independently.
    let remainingImageUrls = Math.max(0, Math.floor(options.maxImageUrlsInMarkdown));
    // If a link wraps only an image (common for galleries), don't emit the `<a href=...>` URL.
    // The user asked to "strip images (aka the links part)" and we're only limiting image URLs.
    turndown.addRule('imageOnlyAnchor', {
        filter: node => {
            if (node.nodeName !== 'A')
                return false;
            const el = node;
            // If there's any visible text, it's a normal link; keep the default behavior.
            const text = el.textContent ?? '';
            if (text.trim() !== '')
                return false;
            const imgs = el.querySelectorAll?.('img') ?? [];
            if (imgs.length === 0)
                return false;
            // Ensure element children are only images; allow whitespace text nodes.
            const elementChildren = Array.from(el.children ?? []);
            return elementChildren.every(child => child.tagName.toLowerCase() === 'img');
        },
        replacement: content => content
    });
    turndown.addRule('limitedImages', {
        filter: 'img',
        replacement: (_content, node) => {
            const img = node;
            const alt = escapeAltText(img.getAttribute?.('alt') ?? '');
            // Prefer the resolved absolute URL when available (JSDOM resolves relative URLs against `url`).
            let src = '';
            try {
                src = typeof img.src === 'string' ? img.src : '';
            }
            catch {
                src = '';
            }
            if (!src)
                src = img.getAttribute?.('src') ?? '';
            src = src.trim();
            // Never emit giant data URLs / blob URLs.
            if (!src || src.startsWith('data:') || src.startsWith('blob:')) {
                return '[Image]';
            }
            // Only count and keep normal web URLs; anything else becomes a placeholder.
            if (!/^https?:\/\//i.test(src)) {
                return '[Image]';
            }
            if (remainingImageUrls > 0) {
                remainingImageUrls -= 1;
                return `![${alt}](${src})`;
            }
            return '[Image]';
        }
    });
    return turndown;
}
export function htmlToMarkdown(html, url, options) {
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;
    const readability = new Readability(doc);
    const parsed = readability.parse();
    const turndown = createTurndown(options);
    if (parsed?.content) {
        const markdown = turndown.turndown(parsed.content);
        return { title: parsed.title ?? undefined, markdown };
    }
    // Fallback: convert full document body.
    const bodyHtml = doc.body?.innerHTML ?? html;
    const markdown = turndown.turndown(bodyHtml);
    const title = doc.title || undefined;
    return { title, markdown };
}
//# sourceMappingURL=html-to-markdown.js.map