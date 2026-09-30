const STRING_TERMINATOR = "(?:\\u0007|\\u001B\\\\|\\u009C)";
const OSC_PATTERN = `(?:\\u001B\\][^\\u0007\\u001B\\u009C]*${STRING_TERMINATOR})`;
const CSI_PATTERN = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
const ESC_OTHER_PATTERN = "\\u001B[@-Z\\\\-_]";
const BRACKETED_PASTE_PATTERN = "\\u001b\\[\\?2004[hl](?:> )?(?:\\r?\\r?\\n)?";

const ANSI_ESCAPE_REGEX = new RegExp(
  `${BRACKETED_PASTE_PATTERN}|${OSC_PATTERN}|${CSI_PATTERN}|${ESC_OTHER_PATTERN}`,
  "g"
);

const ORPHANED_SGR_PATTERN = /\[\d{1,4}(?:;\d{0,4})*m(?!\])/g;
const ESC = 0x1B;
const C1_CSI = 0x9B;
const C1_STRING_TERMINATOR = 0x9C;
const BEL = 0x07;

export interface AnsiStripState {
  pending: string;
}

function findCsiEnd(value: string, parameterStart: number): number {
  for (let index = parameterStart; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7E) {
      return index + 1;
    }
  }

  return -1;
}

function findControlStringEnd(value: string, contentStart: number): number {
  for (let index = contentStart; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === BEL || code === C1_STRING_TERMINATOR) {
      return index + 1;
    }
    if (code === ESC) {
      if (index + 1 >= value.length) {
        return -1;
      }
      if (value.charCodeAt(index + 1) === 0x5C) {
        return index + 2;
      }
    }
  }

  return -1;
}

function isBracketedPasteToggle(value: string, start: number, end: number): boolean {
  return /^\u001B\[\?2004[hl]$/.test(value.slice(start, end));
}

function hasOnlyPossibleBracketedPasteSuffix(value: string, end: number): boolean {
  return /^(?:> ?)?\r{0,2}\n?$/.test(value.slice(end));
}

function findIncompleteAnsiStart(value: string): number {
  let index = 0;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === C1_CSI) {
      const end = findCsiEnd(value, index + 1);
      if (end < 0) {
        return index;
      }
      index = end;
      continue;
    }

    if (code !== ESC) {
      index += 1;
      continue;
    }

    const start = index;
    if (index + 1 >= value.length) {
      return start;
    }

    const nextCode = value.charCodeAt(index + 1);
    if (nextCode === 0x5B) {
      const end = findCsiEnd(value, index + 2);
      if (end < 0 || (isBracketedPasteToggle(value, start, end) && hasOnlyPossibleBracketedPasteSuffix(value, end))) {
        return start;
      }
      index = end;
      continue;
    }

    if (nextCode === 0x5D || nextCode === 0x50 || nextCode === 0x5E || nextCode === 0x5F || nextCode === 0x58) {
      const end = findControlStringEnd(value, index + 2);
      if (end < 0) {
        return start;
      }
      index = end;
      continue;
    }

    index += 2;
  }

  return -1;
}

export function stripAnsi(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  const hasEscape = value.includes("\u001b") || value.includes("\u009b");
  const hasOrphanedSgr = value.includes("[0m") || (value.includes("[") && value.includes("m"));

  if (!hasEscape && !hasOrphanedSgr) {
    return value;
  }

  let cleaned = value;
  if (hasEscape) {
    cleaned = cleaned.replace(ANSI_ESCAPE_REGEX, "").replace(/\u001b/g, "");
  }

  if (cleaned.includes("[") && cleaned.includes("m")) {
    cleaned = cleaned.replace(ORPHANED_SGR_PATTERN, "");
  }

  return cleaned;
}

export function stripAnsiChunk(value: string, state: AnsiStripState): string {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  const combined = `${state.pending}${value}`;
  const incompleteStart = findIncompleteAnsiStart(combined);
  if (incompleteStart < 0) {
    state.pending = "";
    return stripAnsi(combined);
  }

  state.pending = combined.slice(incompleteStart);
  return stripAnsi(combined.slice(0, incompleteStart));
}
