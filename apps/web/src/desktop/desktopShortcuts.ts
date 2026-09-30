export type DesktopShortcutActionId =
  | "quickAgent"
  | "commandPalette"
  | "newTask"
  | "openFiles"
  | "uploadFiles"
  | "revealFolder";

export interface DesktopShortcutPreferences {
  quickAgent: string | null;
  commandPalette: string | null;
  newTask: string | null;
  openFiles: string | null;
  uploadFiles: string | null;
  revealFolder: string | null;
}

export interface DesktopShortcutDefinition {
  id: DesktopShortcutActionId;
  title: string;
  description: string;
  defaultAccelerator: string | null;
  scope: "global" | "inApp";
}

export const DEFAULT_DESKTOP_SHORTCUT_PREFERENCES: DesktopShortcutPreferences = {
  quickAgent: "CommandOrControl+Shift+Space",
  commandPalette: "CommandOrControl+K",
  newTask: "CommandOrControl+N",
  openFiles: "CommandOrControl+Shift+F",
  uploadFiles: "CommandOrControl+Shift+U",
  revealFolder: "CommandOrControl+Shift+O"
};

export const DESKTOP_SHORTCUT_DEFINITIONS: DesktopShortcutDefinition[] = [
  {
    id: "quickAgent",
    title: "Quick Agent",
    description: "Open the floating composer from anywhere on your computer.",
    defaultAccelerator: DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.quickAgent,
    scope: "global"
  },
  {
    id: "commandPalette",
    title: "Command Palette",
    description: "Open the command palette inside the desktop app.",
    defaultAccelerator: DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.commandPalette,
    scope: "inApp"
  },
  {
    id: "newTask",
    title: "New Task",
    description: "Open the current project’s task composer.",
    defaultAccelerator: DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.newTask,
    scope: "inApp"
  },
  {
    id: "openFiles",
    title: "Files",
    description: "Open the current project’s Files page.",
    defaultAccelerator: DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.openFiles,
    scope: "inApp"
  },
  {
    id: "uploadFiles",
    title: "Upload Files",
    description: "Open the native file picker from the current view.",
    defaultAccelerator: DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.uploadFiles,
    scope: "inApp"
  },
  {
    id: "revealFolder",
    title: "Reveal Folder",
    description: "Open the current project folder in Finder or Explorer.",
    defaultAccelerator: DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.revealFolder,
    scope: "inApp"
  }
];

const ACCELERATOR_MODIFIER_LABELS: Record<string, { mac: string; other: string }> = {
  Command: { mac: "⌘", other: "Cmd" },
  CommandOrControl: { mac: "⌘", other: "Ctrl" },
  Control: { mac: "⌃", other: "Ctrl" },
  Alt: { mac: "⌥", other: "Alt" },
  Option: { mac: "⌥", other: "Alt" },
  Shift: { mac: "⇧", other: "Shift" }
};

function normalizeShortcutValue(value: unknown, fallback: string | null): string | null {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sanitizeDesktopShortcutPreferences(input: unknown): DesktopShortcutPreferences {
  const candidate = input && typeof input === "object" && !Array.isArray(input)
    ? input as Partial<Record<keyof DesktopShortcutPreferences, unknown>>
    : {};

  return {
    quickAgent: normalizeShortcutValue(candidate.quickAgent, DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.quickAgent),
    commandPalette: normalizeShortcutValue(candidate.commandPalette, DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.commandPalette),
    newTask: normalizeShortcutValue(candidate.newTask, DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.newTask),
    openFiles: normalizeShortcutValue(candidate.openFiles, DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.openFiles),
    uploadFiles: normalizeShortcutValue(candidate.uploadFiles, DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.uploadFiles),
    revealFolder: normalizeShortcutValue(candidate.revealFolder, DEFAULT_DESKTOP_SHORTCUT_PREFERENCES.revealFolder)
  };
}

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
}

function normalizeAcceleratorKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[a-z0-9]$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  if (/^f\d{1,2}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  switch (trimmed.toLowerCase()) {
    case " ":
    case "space":
    case "spacebar":
      return "Space";
    case "arrowup":
    case "up":
      return "Up";
    case "arrowdown":
    case "down":
      return "Down";
    case "arrowleft":
    case "left":
      return "Left";
    case "arrowright":
    case "right":
      return "Right";
    case "escape":
    case "esc":
      return "Escape";
    case "enter":
    case "return":
      return "Enter";
    case "tab":
      return "Tab";
    case "delete":
    case "del":
      return "Delete";
    case "backspace":
      return "Backspace";
    case "comma":
    case ",":
      return ",";
    case "period":
    case ".":
      return ".";
    case "slash":
    case "/":
      return "/";
    default:
      return null;
  }
}

function isModifierToken(token: string): boolean {
  return token === "Command"
    || token === "CommandOrControl"
    || token === "Control"
    || token === "Alt"
    || token === "Option"
    || token === "Shift";
}

function parseAccelerator(accelerator: string | null): { modifiers: string[]; key: string | null } | null {
  if (!accelerator) {
    return null;
  }

  const tokens = accelerator
    .split("+")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }

  const modifiers = tokens.filter(isModifierToken);
  const key = normalizeAcceleratorKey(tokens.find((token) => !isModifierToken(token)) ?? "");
  if (!key) {
    return null;
  }

  return { modifiers, key };
}

export function formatAcceleratorForDisplay(accelerator: string | null): string {
  if (!accelerator) {
    return "Not set";
  }

  const parsed = parseAccelerator(accelerator);
  if (!parsed) {
    return accelerator;
  }

  const isMac = isMacPlatform();
  const renderedTokens = [
    ...parsed.modifiers.map((modifier) => {
      const label = ACCELERATOR_MODIFIER_LABELS[modifier];
      return label ? (isMac ? label.mac : label.other) : modifier;
    }),
    parsed.key === ","
      ? ","
      : parsed.key === "."
        ? "."
        : parsed.key === "/"
          ? "/"
          : parsed.key
  ];

  return isMac ? renderedTokens.join("") : renderedTokens.join(" + ");
}

export function keyboardEventToAccelerator(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  const key = normalizeAcceleratorKey(event.key);
  if (!key) {
    return null;
  }

  const modifiers: string[] = [];
  if (event.metaKey || event.ctrlKey) {
    modifiers.push("CommandOrControl");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }

  const hasModifier = modifiers.length > 0;
  const isFunctionKey = /^F\d{1,2}$/i.test(key);
  if (!hasModifier && !isFunctionKey) {
    return null;
  }

  return [...modifiers, key].join("+");
}

export function acceleratorMatchesEvent(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  accelerator: string | null
): boolean {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) {
    return false;
  }

  const isMac = isMacPlatform();
  const expectedMeta = parsed.modifiers.includes("Command") || (isMac && parsed.modifiers.includes("CommandOrControl"));
  const expectedCtrl = parsed.modifiers.includes("Control") || (!isMac && parsed.modifiers.includes("CommandOrControl"));
  const expectedAlt = parsed.modifiers.includes("Alt") || parsed.modifiers.includes("Option");
  const expectedShift = parsed.modifiers.includes("Shift");

  if (event.metaKey !== expectedMeta) {
    return false;
  }
  if (event.ctrlKey !== expectedCtrl) {
    return false;
  }
  if (event.altKey !== expectedAlt) {
    return false;
  }
  if (event.shiftKey !== expectedShift) {
    return false;
  }

  return normalizeAcceleratorKey(event.key) === parsed.key;
}
