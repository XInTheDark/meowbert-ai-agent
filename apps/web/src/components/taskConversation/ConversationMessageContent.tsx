import { Children, lazy, Suspense, useCallback, useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import type { TaskAssistantMessageDisplayPreferences } from "../../lib/types";
import { isTaskMessageExpanded, persistTaskMessageExpanded } from "../../task/taskMessageExpansionPreferences";
import { buildConversationSelectionClipboardPayload } from "./conversationMessageClipboard";
import { triggerAuthenticatedBrowserDownload } from "../../lib/authenticated-download";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { MarkdownImage } from "./MarkdownImage";
import { resolveMarkdownDownloadFilename, resolveRuntimeFileDownloadPath, resolveTrustedMarkdownDownloadUrl } from "./markdownDownload";
import { normalizeLatexDelimiters } from "./normalizeLatexDelimiters";
import { stripCitationMarkers } from "./stripCitationMarkers";

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
const LATEX_REHYPE_PLUGINS: PluggableList = [rehypeKatex];
const COMMON_HTML_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
  attributes: {
    ...defaultSchema.attributes,
    details: [...(defaultSchema.attributes?.details ?? []), "open"]
  }
};
const COMMON_HTML_REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, COMMON_HTML_SCHEMA]
];
const COMMON_HTML_LATEX_REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, COMMON_HTML_SCHEMA],
  rehypeKatex
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
  a({ href, children, node: _node, ...props }) {
    const runtimeDownloadPath = resolveRuntimeFileDownloadPath(href);
    const downloadUrl = resolveTrustedMarkdownDownloadUrl(runtimeDownloadPath ?? href);
    const linkHref = runtimeDownloadPath && downloadUrl ? downloadUrl : href;

    const handleClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (downloadUrl && href) {
        event.preventDefault();
        try {
          const token = localStorage.getItem("meowbert_token");
          const filename = resolveMarkdownDownloadFilename(linkHref ?? href, children);
          await triggerAuthenticatedBrowserDownload({
            url: downloadUrl,
            token,
            suggestedFilename: filename
          });
        } catch (err) {
          console.error("Failed to download file from markdown link", err);
        }
      }
    };

    const isExternal = !downloadUrl && typeof linkHref === "string" && (linkHref.startsWith("http://") || linkHref.startsWith("https://")) && !linkHref.startsWith(window.location.origin);

    return (
      <a
        href={linkHref}
        onClick={downloadUrl ? handleClick : props.onClick}
        target={isExternal ? "_blank" : props.target}
        rel={isExternal ? "noopener noreferrer" : props.rel}
        {...props}
      >
        {children}
      </a>
    );
  }
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
  if (!props.displayPreferences.renderMarkdown) {
    return <div className="bubble-plain-text">{props.content}</div>;
  }

  if (props.displayPreferences.renderLatex) {
    const remarkPlugins = props.displayPreferences.allowSingleDollarLatex
      ? SINGLE_DOLLAR_LATEX_MARKDOWN_PLUGINS
      : DOUBLE_DOLLAR_LATEX_MARKDOWN_PLUGINS;

    return (
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={props.displayPreferences.renderCommonHtml
          ? COMMON_HTML_LATEX_REHYPE_PLUGINS
          : LATEX_REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {normalizeLatexDelimiters(props.content)}
      </ReactMarkdown>
    );
  }

  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_PLUGINS}
      rehypePlugins={props.displayPreferences.renderCommonHtml ? COMMON_HTML_REHYPE_PLUGINS : undefined}
      components={MARKDOWN_COMPONENTS}
    >
      {props.content}
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
