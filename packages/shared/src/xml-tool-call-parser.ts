import { XMLParser } from "fast-xml-parser";

export interface ParsedXmlToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

const TOOL_CALL_BLOCK_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;

/**
 * fast-xml-parser cannot handle `=` in tag names (e.g. `<function=run_shell>`).
 * We sanitize those before parsing and map back afterward.
 */
function sanitizeTagNames(xml: string): string {
  // Replace `=` in opening/closing tag names: <function=NAME> -> <fn_name>, </function=NAME> -> </fn_name>
  // Handles both `<function=NAME>` and `<function=NAME attr="val">`
  return xml.replace(
    /<\/?([a-zA-Z_][a-zA-Z0-9_]*)=([a-zA-Z_][a-zA-Z0-9_]*)(?=[\s/>])/g,
    (_match, prefix, suffix) => `<${prefix}_${suffix}`
  ).replace(
    // Also handle closing tags without attributes: </function=NAME>
    /<\/([a-zA-Z_][a-zA-Z0-9_]*)=([a-zA-Z_][a-zA-Z0-9_]*)>/g,
    (_match, prefix, suffix) => `</${prefix}_${suffix}>`
  );
}

const parser = new XMLParser({
  ignoreAttributes: false,
  // Don't parse attribute values as numbers
  parseAttributeValue: false,
  // Preserve the tag structure
  trimValues: true,
});

function parseSingleToolCallXml(xml: string): ParsedXmlToolCall | null {
  const sanitized = sanitizeTagNames(xml);

  let parsed: unknown;
  try {
    parsed = parser.parse(sanitized);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const root = parsed as Record<string, unknown>;
  const fnKey = Object.keys(root).find((k) => k.startsWith("function_"));
  if (!fnKey) {
    return null;
  }

  // Extract function name from sanitized key: "function_run_shell" -> "run_shell"
  const fnName = fnKey.slice("function_".length);
  if (!fnName) {
    return null;
  }

  const fnBody = root[fnKey];
  if (!fnBody || typeof fnBody !== "object") {
    return { name: fnName, arguments: {} };
  }

  const fnRecord = fnBody as Record<string, unknown>;
  const args: Record<string, unknown> = {};

  // Parameters are stored as "parameter_NAME" keys
  for (const [key, value] of Object.entries(fnRecord)) {
    if (key.startsWith("parameter_")) {
      const paramName = key.slice("parameter_".length);
      if (paramName) {
        // Try to parse JSON values (numbers, booleans, arrays, objects)
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed === "null") {
            args[paramName] = null;
          } else if (trimmed === "true") {
            args[paramName] = true;
          } else if (trimmed === "false") {
            args[paramName] = false;
          } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            // Only parse plain decimal integers/floats — reject hex, scientific notation, Infinity, etc.
            args[paramName] = Number(trimmed);
          } else {
            // Try JSON parse for arrays/objects
            try {
              args[paramName] = JSON.parse(trimmed);
            } catch {
              args[paramName] = value;
            }
          }
        } else {
          args[paramName] = value;
        }
      }
    }
  }

  return { name: fnName, arguments: args };
}

/**
 * Parse all ` ` blocks from text into structured tool calls.
 */
export function parseXmlToolCalls(text: string): ParsedXmlToolCall[] {
  const results: ParsedXmlToolCall[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex for global regex
  TOOL_CALL_BLOCK_RE.lastIndex = 0;
  while ((match = TOOL_CALL_BLOCK_RE.exec(text)) !== null) {
    const innerXml = match[1].trim();
    if (!innerXml) {
      continue;
    }
    const parsed = parseSingleToolCallXml(innerXml);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

/**
 * Strip all ` ` blocks from text.
 */
export function stripXmlToolCalls(text: string): string {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}
