// Canvas pages run in an opaque origin, so their localStorage lives here, in the app's own
// storage, keyed per canvas. The frame receives it at load and sends changes back.

const STORAGE_PREFIX = "meowbert:canvas-storage:";
const MAX_STORED_CHARS = 1_000_000;

export function readCanvasStorage(storageKey: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

export function writeCanvasStorage(storageKey: string, items: Record<string, string>): void {
  try {
    const serialized = JSON.stringify(items);
    const key = `${STORAGE_PREFIX}${storageKey}`;
    if (serialized.length > MAX_STORED_CHARS) return;
    if (Object.keys(items).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, serialized);
  } catch {
    // Storage full or blocked: the page keeps its state until it reloads.
  }
}
