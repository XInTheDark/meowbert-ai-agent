import { useEffect, useMemo, useState } from "react";

type Highlighter = typeof import("./markdownCodeHighlighter");

// highlight.js loads the first time a code block needs it; the block shows plain text until then.
let highlighter: Highlighter | null = null;
let highlighterLoad: Promise<Highlighter> | null = null;

function loadHighlighter(): Promise<Highlighter> {
  highlighterLoad ??= import("./markdownCodeHighlighter").then((module) => {
    highlighter = module;
    return module;
  });
  return highlighterLoad;
}

export function preloadCodeHighlighter(): Promise<void> {
  return loadHighlighter().then(() => undefined);
}

export function useHighlightedCode(source: string, language: string | null): string | null {
  const [loaded, setLoaded] = useState(highlighter !== null);

  useEffect(() => {
    if (!language || loaded) return;
    let cancelled = false;
    void loadHighlighter().then(() => { if (!cancelled) setLoaded(true); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [language, loaded]);

  return useMemo(
    () => (loaded && highlighter && language ? highlighter.highlightCodeToHtml(source, language) : null),
    [language, loaded, source]
  );
}
