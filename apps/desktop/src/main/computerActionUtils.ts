import type { ComputerToolName } from "@meowbert/shared";

const MIN_TYPED_TEXT_SETTLE_DELAY_MS = 200;
const MAX_TYPED_TEXT_SETTLE_DELAY_MS = 650;
const KEY_ACTION_SETTLE_DELAY_MS = 180;
const TYPED_TEXT_PREVIEW_MAX_CHARS = 60;

function buildPreview(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function buildComputerTypeSummary(text: string): string {
  if (text.length === 0) {
    return "Typed 0 characters.";
  }

  return `Typed ${JSON.stringify(buildPreview(text, TYPED_TEXT_PREVIEW_MAX_CHARS))} (${text.length} characters).`;
}

export function getPostActionSettleDelayMs(
  toolName: ComputerToolName,
  args: Record<string, unknown>
): number {
  switch (toolName) {
    case "computer_type": {
      const text = typeof args.text === "string" ? args.text : "";
      if (text.length === 0) {
        return 0;
      }

      return Math.min(
        MAX_TYPED_TEXT_SETTLE_DELAY_MS,
        Math.max(MIN_TYPED_TEXT_SETTLE_DELAY_MS, text.length * 12)
      );
    }
    case "computer_key":
    case "computer_hold_key":
      return KEY_ACTION_SETTLE_DELAY_MS;
    default:
      return 0;
  }
}
