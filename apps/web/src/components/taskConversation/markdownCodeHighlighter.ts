import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "bash",
  cc: "cpp",
  "c++": "cpp",
  h: "cpp",
  hpp: "cpp",
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  plain: "text",
  plaintext: "text",
  py: "python",
  sh: "shell",
  text: "text",
  ts: "typescript",
  tsx: "typescript",
  txt: "text",
  yml: "yaml",
  zsh: "shell"
};

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

export function normalizeCodeLanguage(language: string | null | undefined): string | null {
  const normalized = language?.trim().toLowerCase().replace(/^language-/, "");
  if (!normalized) {
    return null;
  }

  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function getCodeLanguageLabel(language: string | null | undefined): string | null {
  const normalizedLabel = language?.trim().toLowerCase().replace(/^language-/, "");
  if (!normalizedLabel || ["plain", "plaintext", "text", "txt"].includes(normalizedLabel)) {
    return null;
  }

  return normalizedLabel;
}

export function highlightCodeToHtml(source: string, language: string | null | undefined): string | null {
  const normalizedLanguage = normalizeCodeLanguage(language);
  if (!normalizedLanguage || !hljs.getLanguage(normalizedLanguage)) {
    return null;
  }

  return hljs.highlight(source, {
    language: normalizedLanguage,
    ignoreIllegals: true
  }).value;
}
