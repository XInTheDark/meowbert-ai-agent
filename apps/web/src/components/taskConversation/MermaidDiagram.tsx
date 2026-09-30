import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { renderMermaidSvg } from "../../lib/mermaid";
import { isThemeDark } from "../../lib/theme";

function writeWithFallbackClipboard(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyCodeToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return writeWithFallbackClipboard(text);
    }
  }

  return writeWithFallbackClipboard(text);
}

function MermaidDiagramToolbar(props: {
  source: string;
}): JSX.Element {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = useCallback(async (): Promise<void> => {
    const copied = await copyCodeToClipboard(props.source);
    setIsCopied(copied);
  }, [props.source]);

  useEffect(() => {
    if (!isCopied) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setIsCopied(false), 1400);
    return () => window.clearTimeout(timeoutId);
  }, [isCopied]);

  return (
    <div className="markdown-code-toolbar">
      <span className="markdown-code-language">Mermaid</span>
      <div className="markdown-code-actions">
        <button
          type="button"
          className="markdown-code-action"
          title={isCopied ? "Copied" : "Copy source"}
          aria-label={isCopied ? "Copied source" : "Copy source"}
          onClick={() => void handleCopy()}
        >
          {isCopied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

function MermaidDiagramLoading(): JSX.Element {
  return (
    <div className="markdown-code-block mermaid-diagram-block">
      <MermaidDiagramToolbar source="" />
      <div className="mermaid-diagram-content">
        <div className="mermaid-diagram-loading" />
      </div>
    </div>
  );
}

export function MermaidDiagram(props: { source: string }): JSX.Element {
  return (
    <Suspense fallback={<MermaidDiagramLoading />}>
      <MermaidDiagramInner source={props.source} />
    </Suspense>
  );
}

function MermaidDiagramInner(props: { source: string }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const themeId = document.documentElement.getAttribute("data-theme") ?? "";
    void renderMermaidSvg(props.source, isThemeDark(themeId) ? "dark" : "default").then(
      (renderedSvg) => {
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render diagram");
          setSvg(null);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [props.source]);

  return (
    <div className="markdown-code-block mermaid-diagram-block">
      <MermaidDiagramToolbar source={props.source} />
      <div className="mermaid-diagram-content" ref={containerRef}>
        {svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : error ? (
          <div className="mermaid-diagram-error">
            <pre className="mermaid-diagram-error-source">{props.source}</pre>
            <span className="mermaid-diagram-error-message">{error}</span>
          </div>
        ) : (
          <div className="mermaid-diagram-loading" />
        )}
      </div>
    </div>
  );
}
