import type { ReactNode } from "react";
import type { ConversationDisplayEntry } from "./conversationActivityEntries";

export interface ConversationMessageAccessory {
  key: string;
  // Placed after everything shown for this message; at the end when it is not on the page.
  anchorMessageId: string | null;
  node: ReactNode;
}

function entryMessageIds(entry: ConversationDisplayEntry): string[] {
  switch (entry.kind) {
    case "message": return [entry.message.id];
    case "activity": return entry.messageIds;
    default: return [];
  }
}

export function insertMessageAccessories(
  entries: ConversationDisplayEntry[],
  accessories: ConversationMessageAccessory[] | undefined
): ConversationDisplayEntry[] {
  if (!accessories || accessories.length === 0) return entries;
  const result = [...entries];
  for (const accessory of accessories) {
    let anchorIndex = -1;
    if (accessory.anchorMessageId) {
      for (let index = result.length - 1; index >= 0; index -= 1) {
        if (entryMessageIds(result[index]).includes(accessory.anchorMessageId)) {
          anchorIndex = index;
          break;
        }
      }
    }
    const entry: ConversationDisplayEntry = { kind: "accessory", key: accessory.key, node: accessory.node };
    if (anchorIndex === -1) result.push(entry);
    else result.splice(anchorIndex + 1, 0, entry);
  }
  return result;
}
