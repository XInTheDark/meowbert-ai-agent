import type { ReactNode } from "react";
import { useMarkdownInlineFileUrlBuilder } from "../MarkdownInlineFileContext";
import { resolveTaskRelativeImagePath } from "../markdownImageSource";
import { CitationIcon } from "./CitationPill";
import { isTaskInputPath } from "./citationToken";

export function resolveCitationPath(href: string | undefined): string | null {
  const relativePath = resolveTaskRelativeImagePath(href);
  return relativePath && isTaskInputPath(relativePath) ? relativePath : null;
}

function readLabel(children: ReactNode): string {
  if (Array.isArray(children)) return children.map(readLabel).join("");
  return typeof children === "string" ? children : "";
}

// A citation in a sent message opens the file. The link waits for its file ticket, so it starts as a plain pill.
export function CitationLink(props: { path: string; children: ReactNode }): JSX.Element {
  const buildFileUrl = useMarkdownInlineFileUrlBuilder();
  const url = buildFileUrl?.(props.path) ?? null;
  const label = readLabel(props.children);
  const content = (
    <>
      <CitationIcon label={label} />
      <span className="citation-pill-label">{props.children}</span>
    </>
  );

  return url
    ? <a className="citation-pill" href={url} target="_blank" rel="noopener noreferrer" title={label} data-citation-path={props.path}>{content}</a>
    : <span className="citation-pill" title={label} data-citation-path={props.path}>{content}</span>;
}
