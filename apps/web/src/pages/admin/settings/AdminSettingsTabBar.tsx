import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Bell,
  Binary,
  ChartNoAxesCombined,
  ChevronDown,
  Database,
  HardDrive,
  LayoutGrid,
  Mail,
  MessageSquareText,
  Plug,
  Radio,
  Server,
  Settings,
  SlidersHorizontal,
  UserRoundCog,
  Users,
  Wrench,
  type LucideIcon
} from "lucide-react";
import type { AdminSettingsTabKey } from "./shared";
import { MenuSheet } from "../../../components/mobile/MenuSheet";

interface AdminTabDefinition {
  key: AdminSettingsTabKey;
  label: string;
  Icon: LucideIcon;
}

interface AdminTabGroup {
  label: string;
  Icon: LucideIcon;
  tabs: AdminTabDefinition[];
}

const tabGroups: AdminTabGroup[] = [
  {
    label: "Operations",
    Icon: LayoutGrid,
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
    Icon: SlidersHorizontal,
    tabs: [
      { key: "settings", label: "Settings", Icon: Settings },
      { key: "model", label: "Model", Icon: MessageSquareText },
      { key: "ai-providers", label: "AI providers", Icon: Plug },
      { key: "embeddings", label: "Embeddings", Icon: Binary },
      { key: "users", label: "Users", Icon: Users },
      { key: "subscriptions", label: "Plans", Icon: UserRoundCog }
    ]
  },
  {
    label: "Channels",
    Icon: Radio,
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

function useCloseOnOutsideInteraction(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);
  return ref;
}

function AdminTabGroupMenu(props: {
  group: AdminTabGroup;
  activeTab: AdminSettingsTabKey;
  open: boolean;
  onToggle: () => void;
  onSelect: (tab: AdminSettingsTabKey) => void;
}) {
  const { group, activeTab, open } = props;
  const activeEntry = group.tabs.find((tab) => tab.key === activeTab);
  const GroupIcon = group.Icon;
  const menuId = `admin-nav-menu-${group.label.toLowerCase()}`;

  return (
    <div className="admin-nav__group">
      <button
        type="button"
        className={`admin-nav__trigger ${activeEntry ? "active" : ""}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={props.onToggle}
      >
        <GroupIcon size={16} />
        <span>{group.label}</span>
        {activeEntry ? <span className="admin-nav__current">{activeEntry.label}</span> : null}
        <ChevronDown size={14} className="admin-nav__chevron" />
      </button>
      {open ? (
        <MenuSheet label={group.label} onClose={props.onToggle}>
          <div id={menuId} className="admin-nav__menu" role="group" aria-label={group.label}>
            {group.tabs.map((tab) => {
              const Icon = tab.Icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`admin-nav__item ${activeTab === tab.key ? "active" : ""}`}
                  aria-current={activeTab === tab.key ? "page" : undefined}
                  onClick={() => props.onSelect(tab.key)}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </MenuSheet>
      ) : null}
    </div>
  );
}

export function AdminSettingsTabBar({ activeTab, onTabChange }: AdminSettingsTabBarProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const close = useRef(() => setOpenGroup(null)).current;
  const navRef = useCloseOnOutsideInteraction(openGroup !== null, close);

  return (
    <div ref={navRef}>
      <nav className="admin-nav" aria-label="Admin sections">
        {tabGroups.map((group) => (
          <AdminTabGroupMenu
            key={group.label}
            group={group}
            activeTab={activeTab}
            open={openGroup === group.label}
            onToggle={() => setOpenGroup((current) => (current === group.label ? null : group.label))}
            onSelect={(tab) => {
              setOpenGroup(null);
              onTabChange(tab);
            }}
          />
        ))}
      </nav>
    </div>
  );
}
