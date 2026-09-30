import { createContext, useContext } from "react";
import type { BuildInlineFileUrl } from "./markdownImageSource";

export const MarkdownInlineFileContext = createContext<BuildInlineFileUrl | null>(null);

export function useMarkdownInlineFileUrlBuilder(): BuildInlineFileUrl | null {
  return useContext(MarkdownInlineFileContext);
}
