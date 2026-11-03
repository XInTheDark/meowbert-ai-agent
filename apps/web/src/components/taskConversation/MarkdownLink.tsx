import { useState, type ComponentPropsWithoutRef, type MouseEvent } from "react";
import { Loader2 } from "lucide-react";
import type { ExtraProps } from "react-markdown";
import { triggerAuthenticatedBrowserDownload } from "../../lib/authenticated-download";
import { CitationLink, resolveCitationPath } from "./composer/CitationLink";
import { resolveMarkdownDownloadFilename, resolveRuntimeFileDownloadPath, resolveTrustedMarkdownDownloadUrl } from "./markdownDownload";

type MarkdownLinkProps = ComponentPropsWithoutRef<"a"> & ExtraProps;

export function MarkdownLink({ href, children, node: _node, ...props }: MarkdownLinkProps) {
  const citationPath = resolveCitationPath(href);
  return citationPath
    ? <CitationLink path={citationPath}>{children}</CitationLink>
    : <StandardMarkdownLink href={href} node={_node} {...props}>{children}</StandardMarkdownLink>;
}

function StandardMarkdownLink({ href, children, node: _node, ...props }: MarkdownLinkProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const runtimeDownloadPath = resolveRuntimeFileDownloadPath(href);
  const downloadUrl = resolveTrustedMarkdownDownloadUrl(runtimeDownloadPath ?? href);
  const linkHref = runtimeDownloadPath && downloadUrl ? downloadUrl : href;

  const handleDownloadClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!downloadUrl || !href) {
      return;
    }

    event.preventDefault();
    if (isDownloading) {
      return;
    }

    setIsDownloading(true);
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
    } finally {
      setIsDownloading(false);
    }
  };

  const isExternal = !downloadUrl && typeof linkHref === "string" && (linkHref.startsWith("http://") || linkHref.startsWith("https://")) && !linkHref.startsWith(window.location.origin);

  return (
    <a
      href={linkHref}
      onClick={downloadUrl ? handleDownloadClick : props.onClick}
      target={isExternal ? "_blank" : props.target}
      rel={isExternal ? "noopener noreferrer" : props.rel}
      {...props}
      aria-busy={isDownloading || undefined}
      className={[props.className, isDownloading ? "markdown-link-downloading" : null].filter(Boolean).join(" ") || undefined}
    >
      {children}
      {isDownloading ? <Loader2 className="spin markdown-link-spinner" size={13} aria-label="Downloading" /> : null}
    </a>
  );
}
