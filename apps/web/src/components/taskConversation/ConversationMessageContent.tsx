import { Children, lazy, Suspense, useCallback, useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import type { TaskAssistantMessageDisplayPreferences } from "../../lib/types";
import { isTaskMessageExpanded, persistTaskMessageExpanded } from "../../task/taskMessageExpansionPreferences";
import { buildConversationSelectionClipboardPayload } from "./conversationMessageClipboard";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { MarkdownImage } from "./MarkdownImage";
import { MarkdownLink } from "./MarkdownLink";
import { normalizeLatexDelimiters } from "./normalizeLatexDelimiters";
import { stripCitationMarkers } from "./stripCitationMarkers";
import { useExpandOnBottomOverscroll } from "./useExpandOnBottomOverscroll";
import { markdownNeedsHtml, useMarkdownRehypePlugins } from "./useMarkdownRehypePlugins";

const LazyMermaidDiagram = lazy(() => import("./MermaidDiagram").then((mod) => ({ default: mod.MermaidDiagram })));

const LONG_MESSAGE_CHARACTER_THRESHOLD = 5000;
const LONG_MESSAGE_LINE_THRESHOLD = 25;
const MARKDOWN_PLUGINS: PluggableList = [remarkGfm];
const DOUBLE_DOLLAR_LATEX_MARKDOWN_PLUGINS: PluggableList = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }]
];
const SINGLE_DOLLAR_LATEX_MARKDOWN_PLUGINS: PluggableList = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: true }]
];
const LANGUAGE_CLASS_PATTERN = /(?:^|\s)language-([^\s]+)/;

function getMarkdownCodeText(children: ReactNode): string {
  return Children.toArray(children).join("");
}

function getMarkdownCodeLanguage(className: string | undefined): string | null {
  return LANGUAGE_CLASS_PATTERN.exec(className ?? "")?.[1] ?? null;
}

const MARKDOWN_COMPONENTS: Components = {
  img: MarkdownImage,
  pre({ children }) {
    return <>{children}</>;
  },
  code({ children, className, node: _node, ...props }) {
    const codeText = getMarkdownCodeText(children);
    const language = getMarkdownCodeLanguage(className);
    if (language === "mermaid") {
      return (
        <Suspense fallback={<div className="markdown-code-block mermaid-diagram-block"><div className="markdown-code-toolbar"><span className="markdown-code-language">Mermaid</span></div><div className="mermaid-diagram-content"><div className="mermaid-diagram-loading" /></div></div>}>
          <LazyMermaidDiagram source={codeText.replace(/\n$/, "")} />
        </Suspense>
      );
    }
    if (language || codeText.includes("\n")) {
      return <MarkdownCodeBlock language={language} source={codeText.replace(/\n$/, "")} />;
    }

    return <code className={className} {...props}>{children}</code>;
  },
  a: MarkdownLink
};

function shouldCollapseLongMessage(content: string): boolean {
  const trimmedContent = content.trim();
  if (trimmedContent.length === 0) {
    return false;
  }

  return trimmedContent.length >= LONG_MESSAGE_CHARACTER_THRESHOLD
    || trimmedContent.split(/\r?\n/).length >= LONG_MESSAGE_LINE_THRESHOLD;
}

function RenderedConversationMessageContent(props: {
  content: string;
  displayPreferences: TaskAssistantMessageDisplayPreferences;
}): JSX.Element {
  const preferences = props.displayPreferences;
  const content = preferences.renderMarkdown && preferences.renderLatex
    ? normalizeLatexDelimiters(props.content)
    : props.content;
  const rehypePlugins = useMarkdownRehypePlugins({
    math: preferences.renderMarkdown && preferences.renderLatex && content.includes("$"),
    html: preferences.renderMarkdown && preferences.renderCommonHtml && markdownNeedsHtml(content)
  });

  if (!preferences.renderMarkdown) {
    return <div className="bubble-plain-text">{props.content}</div>;
  }

  const remarkPlugins = !preferences.renderLatex
    ? MARKDOWN_PLUGINS
    : preferences.allowSingleDollarLatex
      ? SINGLE_DOLLAR_LATEX_MARKDOWN_PLUGINS
      : DOUBLE_DOLLAR_LATEX_MARKDOWN_PLUGINS;
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={MARKDOWN_COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
}

export function ConversationMessageContent(props: {
  content: string;
  displayPreferences: TaskAssistantMessageDisplayPreferences;
  enableLongMessageCollapse?: boolean;
  forceExpanded?: boolean;
  expansionKey?: string;
}): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null);
  const displayContent = props.displayPreferences.hideCitationMarkers
    ? stripCitationMarkers(props.content)
    : props.content;
  const shouldAutoCollapse =
    props.enableLongMessageCollapse === true
    && props.displayPreferences.collapseLongMessages
    && shouldCollapseLongMessage(displayContent)
    && !props.forceExpanded;
  const [isExpanded, setIsExpanded] = useState(
    () => !shouldAutoCollapse || isTaskMessageExpanded(props.expansionKey)
  );

  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>): void => {
    const payload = buildConversationSelectionClipboardPayload(contentRef.current, window.getSelection());
    if (!payload || !event.clipboardData) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData("text/plain", payload.text);
    event.clipboardData.setData("text/html", payload.html);
  }, []);

  useEffect(() => {
    setIsExpanded(!shouldAutoCollapse || isTaskMessageExpanded(props.expansionKey));
  }, [props.content, props.expansionKey, shouldAutoCollapse]);

  const toggleExpanded = useCallback((): void => {
    setIsExpanded((current) => {
      const expanded = !current;
      persistTaskMessageExpanded(props.expansionKey, expanded);
      return expanded;
    });
  }, [props.expansionKey]);

  const toggleRef = useRef<HTMLButtonElement>(null);
  const expand = useCallback((): void => {
    persistTaskMessageExpanded(props.expansionKey, true);
    setIsExpanded(true);
  }, [props.expansionKey]);
  useExpandOnBottomOverscroll(toggleRef, shouldAutoCollapse && !isExpanded, expand);

  return (
    <div ref={contentRef} className="conversation-message-content" onCopy={handleCopy}>
      {!shouldAutoCollapse ? (
        <RenderedConversationMessageContent
          content={displayContent}
          displayPreferences={props.displayPreferences}
        />
      ) : (
        <div className="bubble-collapsible-shell">
          <div className={`bubble-collapsible-body${isExpanded ? "" : " collapsed"}`}>
            <RenderedConversationMessageContent
              content={displayContent}
              displayPreferences={props.displayPreferences}
            />
          </div>
          <button
            ref={toggleRef}
            type="button"
            className="bubble-collapsible-toggle"
            onClick={toggleExpanded}
          >
            {isExpanded ? "Show less" : "Read more"}
          </button>
        </div>
      )}
    </div>
  );
}
