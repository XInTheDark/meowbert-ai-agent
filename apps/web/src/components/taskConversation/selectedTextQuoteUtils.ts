export interface SelectedTextLocation {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface SelectedTextQuote {
  text: string;
  location: string | null;
  comment?: string | null;
}

export interface MessageSelectedTextQuote extends SelectedTextQuote {
  messageId: string;
}

const QUOTE_BLOCK_PATTERN = /About this selected (?:snippet|excerpt)(?: \(([^)]+)\))?:\n((?:>.*(?:\n|$))*)(?:(?:Comment|Annotation):\s*([^\n]+(?:\n(?!(?:About this selected snippet|About this selected excerpt|\n\n))[^\n]+)*))?/g;

function quoteSelectedText(selectedText: string): string {
  return selectedText
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function unquoteSelectedText(quotedText: string): string {
  return quotedText
    .split(/\r?\n/)
    .map((line) => line.startsWith("> ") ? line.slice(2) : line.startsWith(">") ? line.slice(1) : line)
    .join("\n")
    .trim();
}

export function formatSelectedTextLocation(location: SelectedTextLocation | null): string | null {
  if (!location) {
    return null;
  }

  return `line ${location.startLine}:${location.startColumn} to line ${location.endLine}:${location.endColumn}`;
}

export function getSelectedTextQuotePreview(text: string): string {
  const lines = text.trim().split(/\r?\n/);
  const visibleLines = lines.slice(-3);
  if (visibleLines.length === lines.length) {
    return visibleLines.join("\n");
  }

  return ["...", ...visibleLines].join("\n");
}

function buildSelectedTextBlock(quote: SelectedTextQuote): string {
  const header = quote.location
    ? `About this selected snippet (${quote.location}):`
    : "About this selected snippet:";

  const lines = [
    header,
    quoteSelectedText(quote.text)
  ];

  if (quote.comment?.trim()) {
    lines.push(`Comment: ${quote.comment.trim()}`);
  }

  return lines.join("\n");
}

export function buildSelectedTextMessage(
  quotes: SelectedTextQuote | SelectedTextQuote[],
  message: string
): string {
  const quoteList = Array.isArray(quotes) ? quotes : [quotes];
  const trimmedMessage = message.trim();

  return [
    ...quoteList.map(buildSelectedTextBlock),
    ...(trimmedMessage.length > 0 ? ["", trimmedMessage] : [])
  ].join("\n");
}

export function splitSelectedTextMessage(content: string): {
  quotes: SelectedTextQuote[];
  message: string;
} | null {
  const quotes: SelectedTextQuote[] = [];
  let messageStartIndex = 0;

  for (const match of content.matchAll(QUOTE_BLOCK_PATTERN)) {
    const text = unquoteSelectedText(match[2] ?? "");
    if (!text) {
      continue;
    }

    const comment = match[3]?.trim() || null;

    quotes.push({
      text,
      location: match[1] ?? null,
      ...(comment ? { comment } : {})
    });
    messageStartIndex = (match.index ?? 0) + match[0].length;
  }

  if (quotes.length === 0) {
    return null;
  }

  return {
    quotes,
    message: content.slice(messageStartIndex).trimStart()
  };
}

