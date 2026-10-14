import { useEffect, useMemo, useState } from "react";
import type { Pluggable, PluggableList } from "unified";

// Math and raw HTML support load the first time a message needs them, then stay loaded. Until then
// the message renders without them for a moment.
let mathPlugin: Pluggable | null = null;
let htmlPlugins: PluggableList | null = null;
let mathLoad: Promise<void> | null = null;
let htmlLoad: Promise<void> | null = null;

function loadMath(): Promise<void> {
  mathLoad ??= import("./markdownMathKit").then((kit) => { mathPlugin = kit.MATH_REHYPE_PLUGIN; });
  return mathLoad;
}

function loadHtml(): Promise<void> {
  htmlLoad ??= import("./markdownHtmlKit").then((kit) => { htmlPlugins = kit.HTML_REHYPE_PLUGINS; });
  return htmlLoad;
}

// Warms both up ahead of need, so the first message using them renders fully straight away.
export function preloadMarkdownRehypePlugins(): Promise<void> {
  return Promise.all([loadMath(), loadHtml()]).then(() => undefined);
}

const HTML_TAG_PATTERN = /<[a-zA-Z!/]/;

export function markdownNeedsHtml(content: string): boolean {
  return HTML_TAG_PATTERN.test(content);
}

export function useMarkdownRehypePlugins(needs: { math: boolean; html: boolean }): PluggableList | undefined {
  const [, setLoadedVersion] = useState(0);
  const missingMath = needs.math && !mathPlugin;
  const missingHtml = needs.html && !htmlPlugins;

  useEffect(() => {
    if (!missingMath && !missingHtml) return;
    let cancelled = false;
    void Promise.all([missingMath ? loadMath() : null, missingHtml ? loadHtml() : null])
      .then(() => { if (!cancelled) setLoadedVersion((version) => version + 1); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [missingMath, missingHtml]);

  const useHtml = needs.html && htmlPlugins !== null;
  const useMath = needs.math && mathPlugin !== null;
  return useMemo(() => {
    const plugins: PluggableList = [...(useHtml ? htmlPlugins ?? [] : []), ...(useMath && mathPlugin ? [mathPlugin] : [])];
    return plugins.length > 0 ? plugins : undefined;
  }, [useHtml, useMath]);
}
