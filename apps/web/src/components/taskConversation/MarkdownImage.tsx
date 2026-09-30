import type { ComponentPropsWithoutRef } from "react";
import type { ExtraProps } from "react-markdown";
import { resolveMarkdownImageSource } from "./markdownImageSource";
import { useMarkdownInlineFileUrlBuilder } from "./MarkdownInlineFileContext";

type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & ExtraProps;

export function MarkdownImage({ src, alt, node: _node, ...props }: MarkdownImageProps): JSX.Element {
  const source = resolveMarkdownImageSource(src, useMarkdownInlineFileUrlBuilder());
  if (source.kind === "task-file" && !source.src) {
    // The inline file ticket is still loading; show the caption instead of a broken image.
    return <span>{alt}</span>;
  }

  return <img src={source.src ?? undefined} alt={alt} loading="lazy" {...props} />;
}
