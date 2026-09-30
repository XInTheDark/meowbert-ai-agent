import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Bot,
  Boxes,
  Brain,
  BriefcaseBusiness,
  Building2,
  ChartNoAxesCombined,
  CircuitBoard,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Database,
  Factory,
  FlaskConical,
  FolderKanban,
  Globe2,
  Hammer,
  Headphones,
  Landmark,
  Layers3,
  Lightbulb,
  LockKeyhole,
  MessageSquare,
  Network,
  Palette,
  PenTool,
  Rocket,
  Server,
  Settings2,
  Shield,
  ShoppingBag,
  Sparkles,
  SquareTerminal,
  Store,
  UsersRound,
  Wrench,
  Zap
} from "lucide-react";
import {
  DEFAULT_WORKSPACE_ICON_KEY,
  WORKSPACE_ICON_KEYS,
  normalizeWorkspaceIconKey,
  type WorkspaceIconKey
} from "@meowbert/shared/workspace-icons";

export interface WorkspaceIconOption {
  key: WorkspaceIconKey;
  label: string;
  Icon: LucideIcon;
}

const WORKSPACE_ICON_OPTION_MAP: Record<WorkspaceIconKey, WorkspaceIconOption> = {
  "folder-kanban": { key: "folder-kanban", label: "Workspace", Icon: FolderKanban },
  "briefcase-business": { key: "briefcase-business", label: "Briefcase", Icon: BriefcaseBusiness },
  "building-2": { key: "building-2", label: "Building", Icon: Building2 },
  boxes: { key: "boxes", label: "Operations", Icon: Boxes },
  database: { key: "database", label: "Data", Icon: Database },
  "square-terminal": { key: "square-terminal", label: "Terminal", Icon: SquareTerminal },
  rocket: { key: "rocket", label: "Launch", Icon: Rocket },
  cloud: { key: "cloud", label: "Cloud", Icon: Cloud },
  "globe-2": { key: "globe-2", label: "Global", Icon: Globe2 },
  cpu: { key: "cpu", label: "Compute", Icon: Cpu },
  shield: { key: "shield", label: "Secure", Icon: Shield },
  sparkles: { key: "sparkles", label: "Special", Icon: Sparkles },
  bot: { key: "bot", label: "Bot", Icon: Bot },
  brain: { key: "brain", label: "Brain", Icon: Brain },
  "code-2": { key: "code-2", label: "Code", Icon: Code2 },
  compass: { key: "compass", label: "Compass", Icon: Compass },
  "flask-conical": { key: "flask-conical", label: "Research", Icon: FlaskConical },
  hammer: { key: "hammer", label: "Build", Icon: Hammer },
  headphones: { key: "headphones", label: "Support", Icon: Headphones },
  landmark: { key: "landmark", label: "Institution", Icon: Landmark },
  "layers-3": { key: "layers-3", label: "Layers", Icon: Layers3 },
  lightbulb: { key: "lightbulb", label: "Ideas", Icon: Lightbulb },
  "lock-keyhole": { key: "lock-keyhole", label: "Private", Icon: LockKeyhole },
  "message-square": { key: "message-square", label: "Chat", Icon: MessageSquare },
  network: { key: "network", label: "Network", Icon: Network },
  palette: { key: "palette", label: "Design", Icon: Palette },
  "pen-tool": { key: "pen-tool", label: "Creative", Icon: PenTool },
  server: { key: "server", label: "Server", Icon: Server },
  "settings-2": { key: "settings-2", label: "Settings", Icon: Settings2 },
  "shopping-bag": { key: "shopping-bag", label: "Commerce", Icon: ShoppingBag },
  store: { key: "store", label: "Store", Icon: Store },
  "users-round": { key: "users-round", label: "Team", Icon: UsersRound },
  wrench: { key: "wrench", label: "Tools", Icon: Wrench },
  zap: { key: "zap", label: "Fast", Icon: Zap },
  archive: { key: "archive", label: "Archive", Icon: Archive },
  "chart-no-axes-combined": { key: "chart-no-axes-combined", label: "Analytics", Icon: ChartNoAxesCombined },
  "circuit-board": { key: "circuit-board", label: "Engineering", Icon: CircuitBoard },
  factory: { key: "factory", label: "Production", Icon: Factory }
};

export const WORKSPACE_ICON_OPTIONS: WorkspaceIconOption[] = WORKSPACE_ICON_KEYS.map(
  (key) => WORKSPACE_ICON_OPTION_MAP[key]
);

export function resolveWorkspaceIconOption(iconKey: unknown): WorkspaceIconOption {
  return WORKSPACE_ICON_OPTION_MAP[normalizeWorkspaceIconKey(iconKey)];
}

interface WorkspaceIconProps {
  iconKey?: WorkspaceIconKey | null;
  size?: number;
  className?: string;
}

export function WorkspaceIcon({ iconKey, size = 16, className }: WorkspaceIconProps) {
  const option = resolveWorkspaceIconOption(iconKey ?? DEFAULT_WORKSPACE_ICON_KEY);
  const Icon = option.Icon;
  return <Icon size={size} className={className} aria-hidden="true" />;
}
