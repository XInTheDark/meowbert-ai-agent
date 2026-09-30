export const WORKSPACE_ICON_KEYS = [
  "folder-kanban",
  "briefcase-business",
  "building-2",
  "boxes",
  "database",
  "square-terminal",
  "rocket",
  "cloud",
  "globe-2",
  "cpu",
  "shield",
  "sparkles",
  "bot",
  "brain",
  "code-2",
  "compass",
  "flask-conical",
  "hammer",
  "headphones",
  "landmark",
  "layers-3",
  "lightbulb",
  "lock-keyhole",
  "message-square",
  "network",
  "palette",
  "pen-tool",
  "server",
  "settings-2",
  "shopping-bag",
  "store",
  "users-round",
  "wrench",
  "zap",
  "archive",
  "chart-no-axes-combined",
  "circuit-board",
  "factory"
] as const;

export type WorkspaceIconKey = (typeof WORKSPACE_ICON_KEYS)[number];

export const DEFAULT_WORKSPACE_ICON_KEY: WorkspaceIconKey = "folder-kanban";

const WORKSPACE_ICON_KEY_SET = new Set<string>(WORKSPACE_ICON_KEYS);

export function isWorkspaceIconKey(value: unknown): value is WorkspaceIconKey {
  return typeof value === "string" && WORKSPACE_ICON_KEY_SET.has(value);
}

export function normalizeWorkspaceIconKey(value: unknown): WorkspaceIconKey {
  return isWorkspaceIconKey(value) ? value : DEFAULT_WORKSPACE_ICON_KEY;
}
