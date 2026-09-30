export type HtmlToMarkdownOptions = {
    /**
     * Keep only the first N image URLs (from `<img src=...>`). After that, render `[Image]`.
     * This prevents mega-markdown dumps containing tons of tracking/cdn image links.
     */
    maxImageUrlsInMarkdown: number;
};
export declare function htmlToMarkdown(html: string, url: string, options: HtmlToMarkdownOptions): {
    title?: string;
    markdown: string;
};
