import {
  Activity,
  Bell,
  ChartNoAxesCombined,
  Database,
  HardDrive,
  Mail,
  MessageSquareText,
  Plug,
  Server,
  Settings,
  UserRoundCog,
  Users,
  Wrench,
  type LucideIcon
} from "lucide-react";
import type { AdminSettingsTabKey } from "./shared";

interface AdminTabDefinition {
  key: AdminSettingsTabKey;
  label: string;
  Icon: LucideIcon;
}

const tabGroups: Array<{ label: string; tabs: AdminTabDefinition[] }> = [
  {
    label: "Operations",
    tabs: [
      { key: "statistics", label: "Statistics", Icon: ChartNoAxesCombined },
      { key: "processes", label: "Processes", Icon: Activity },
      { key: "utilities", label: "Utilities", Icon: Wrench },
      { key: "storage", label: "Storage", Icon: HardDrive },
      { key: "host-storage", label: "Host storage", Icon: Server },
      { key: "migrations", label: "Migrations", Icon: Database }
    ]
  },
  {
    label: "Platform",
    tabs: [
      { key: "settings", label: "Settings", Icon: Settings },
      { key: "model", label: "Model", Icon: MessageSquareText },
      { key: "ai-providers", label: "AI providers", Icon: Plug },
      { key: "users", label: "Users", Icon: Users },
      { key: "subscriptions", label: "Plans", Icon: UserRoundCog }
    ]
  },
  {
    label: "Channels",
    tabs: [
      { key: "newsletter", label: "Newsletter", Icon: Mail },
      { key: "announcements", label: "Announcements", Icon: Bell },
      { key: "connectors", label: "Connectors", Icon: Plug },
      { key: "sources", label: "Sources", Icon: Database }
    ]
  }
];

interface AdminSettingsTabBarProps {
  activeTab: AdminSettingsTabKey;
  onTabChange: (tab: AdminSettingsTabKey) => void;
}

export function AdminSettingsTabBar({ activeTab, onTabChange }: AdminSettingsTabBarProps) {
  return (
    <nav className="admin-nav" aria-label="Admin sections">
      {tabGroups.map((group) => (
        <section key={group.label} className="admin-nav__group" aria-label={group.label}>
          <span className="admin-nav__group-label">{group.label}</span>
          <div className="admin-nav__items">
            {group.tabs.map((tab) => {
              const Icon = tab.Icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`admin-nav__item ${activeTab === tab.key ? "active" : ""}`}
                  aria-current={activeTab === tab.key ? "page" : undefined}
                  onClick={() => onTabChange(tab.key)}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}
