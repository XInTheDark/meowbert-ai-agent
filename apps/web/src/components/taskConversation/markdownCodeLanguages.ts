// Language names for code blocks, kept apart from the highlighter so labels need no highlight.js.
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
