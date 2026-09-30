const FENCED_CODE_BLOCK_PATTERN = /(^|\n)( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\2\3(?=\n|$)|$)/g;
const INLINE_CODE_PATTERN = /(`+)([\s\S]*?)\1/g;
const LATEX_DISPLAY_BRACKET_PATTERN = /(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g;
const LATEX_INLINE_PAREN_PATTERN = /(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g;
const LATEX_PAIRED_DOUBLE_DOLLAR_PATTERN = /\$\$([\s\S]*?)\$\$/g;
const LATEX_STANDALONE_LINE_DOUBLE_DOLLAR_PATTERN = /(^|\n)([ \t]*)\$\$([^\n$]+)\$\$([ \t]*)(?=\n|$)/g;
const LATEX_ENVIRONMENT_BLOCK_PATTERN = /(?<!\\)\\begin\{(equation|align|gather)\*?\}([\s\S]*?)(?<!\\)\\end\{\1\*?\}/g;
const UNMATCHED_START_DOUBLE_DOLLAR_PATTERN = /(^|\n)([ \t]*)\$\$(?!\$)/g;

function protectCodeSegments(content: string): { text: string; codeBlocks: string[] } {
  const codeBlocks: string[] = [];
  let text = content.replace(FENCED_CODE_BLOCK_PATTERN, (match, prefix: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match.slice(prefix.length));
    return `${prefix}\uE000CODE_${idx}\uE000`;
  });

  text = text.replace(INLINE_CODE_PATTERN, (match) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `\uE000CODE_${idx}\uE000`;
  });

  return { text, codeBlocks };
}

function restoreCodeSegments(text: string, codeBlocks: string[]): string {
  return text.replace(/\uE000CODE_(\d+)\uE000/g, (_, id: string) => codeBlocks[Number(id)] ?? "");
}

function formatDisplayMathBlock(math: string): string {
  return `\n\n$$\n${math.trim()}\n$$\n\n`;
}

function normalizeDisplayAndInlineDelimiters(
  rawText: string,
  displayMathBlocks: string[]
): string {
  // 1. Normalize \[ ... \] display math blocks
  let text = rawText.replace(LATEX_DISPLAY_BRACKET_PATTERN, (_, math: string) => {
    const idx = displayMathBlocks.length;
    displayMathBlocks.push(formatDisplayMathBlock(math));
    return `\uE000MATH_BLOCK_${idx}\uE000`;
  });

  // 2. Normalize \( ... \) inline math
  text = text.replace(LATEX_INLINE_PAREN_PATTERN, (_, math: string) => {
    return `$$${math.trim()}$$`;
  });

  // 3. Normalize paired $$ ... $$ blocks
  text = text.replace(LATEX_PAIRED_DOUBLE_DOLLAR_PATTERN, (match, math: string) => {
    const trimmed = math.trim();
    if (trimmed.length === 0) {
      return match;
    }
    if (trimmed.includes("\n")) {
      const idx = displayMathBlocks.length;
      displayMathBlocks.push(formatDisplayMathBlock(trimmed));
      return `\uE000MATH_BLOCK_${idx}\uE000`;
    }
    return `$$${trimmed}$$`;
  });

  return text;
}

function normalizeStandaloneBlocks(
  rawText: string,
  displayMathBlocks: string[]
): string {
  // 4. Standalone single-line $$ math $$ on its own line
  let text = rawText.replace(
    LATEX_STANDALONE_LINE_DOUBLE_DOLLAR_PATTERN,
    (match, before: string, _indent: string, math: string) => {
      const trimmed = math.trim();
      if (trimmed.length === 0) {
        return match;
      }
      const idx = displayMathBlocks.length;
      displayMathBlocks.push(formatDisplayMathBlock(trimmed));
      return `${before}\uE000MATH_BLOCK_${idx}\uE000`;
    }
  );

  // 5. Standalone \begin{equation|align|gather} blocks
  text = text.replace(LATEX_ENVIRONMENT_BLOCK_PATTERN, (match: string) => {
    const idx = displayMathBlocks.length;
    displayMathBlocks.push(formatDisplayMathBlock(match));
    return `\uE000MATH_BLOCK_${idx}\uE000`;
  });

  // 6. Escape any remaining unmatched $$ at line starts
  text = text.replace(UNMATCHED_START_DOUBLE_DOLLAR_PATTERN, "$1$2\\$\\$");

  return text;
}

export function normalizeLatexDelimiters(content: string): string {
  if (!content) {
    return "";
  }

  const normalizedContent = content.replace(/\r\n/g, "\n");
  const { text: protectedText, codeBlocks } = protectCodeSegments(normalizedContent);
  const displayMathBlocks: string[] = [];

  let text = normalizeDisplayAndInlineDelimiters(protectedText, displayMathBlocks);
  text = normalizeStandaloneBlocks(text, displayMathBlocks);

  // Restore isolated display math blocks
  text = text.replace(
    /\uE000MATH_BLOCK_(\d+)\uE000/g,
    (_, id: string) => displayMathBlocks[Number(id)] ?? ""
  );

  return restoreCodeSegments(text, codeBlocks);
}
