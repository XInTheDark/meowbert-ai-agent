import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";

const COMMON_HTML_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
  attributes: {
    ...defaultSchema.attributes,
    details: [...(defaultSchema.attributes?.details ?? []), "open"]
  }
};

// Loaded on demand: parsing raw HTML pulls in a full HTML parser.
export const HTML_REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, COMMON_HTML_SCHEMA]
];
