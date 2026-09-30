import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, WrapText } from "lucide-react";
import { getCodeLanguageLabel, highlightCodeToHtml, normalizeCodeLanguage } from "./markdownCodeHighlighter";

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

export function MarkdownCodeBlock(props: {
  language?: string | null;
  source: string;
}): JSX.Element {
  const [isCopied, setIsCopied] = useState(false);
  const [isWrapped, setIsWrapped] = useState(false);
  const language = normalizeCodeLanguage(props.language);
  const languageLabel = getCodeLanguageLabel(props.language);
  const highlightedHtml = useMemo(
    () => highlightCodeToHtml(props.source, language),
    [language, props.source]
  );

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
    <div className={`markdown-code-block${isWrapped ? " is-wrapped" : ""}`}>
      <div className="markdown-code-toolbar">
        {languageLabel ? <span className="markdown-code-language">{languageLabel}</span> : <span />}
        <div className="markdown-code-actions">
          <button
            type="button"
            className="markdown-code-action"
            title={isCopied ? "Copied" : "Copy code"}
            aria-label={isCopied ? "Copied code" : "Copy code"}
            onClick={() => void handleCopy()}
          >
            {isCopied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className={`markdown-code-action${isWrapped ? " active" : ""}`}
            title={isWrapped ? "Disable text wrapping" : "Wrap text"}
            aria-label={isWrapped ? "Disable text wrapping" : "Wrap text"}
            aria-pressed={isWrapped}
            onClick={() => setIsWrapped((current) => !current)}
          >
            <WrapText size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      {highlightedHtml ? (
        <pre className="markdown-code-pre">
          <code
            className="markdown-code hljs"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      ) : (
        <pre className="markdown-code-pre">
          <code className="markdown-code">{props.source}</code>
        </pre>
      )}
    </div>
  );
}
