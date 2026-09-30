import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  extraClassName?: string;
  forceActive?: boolean;
  onPrefetch?: () => void;
}

export function SidebarNavItem({
  item,
  collapsed,
  onNavigate
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        [
          "nav-link",
          item.extraClassName,
          isActive || item.forceActive ? "active" : ""
        ].filter(Boolean).join(" ")
      }
      onClick={onNavigate}
      onPointerEnter={item.onPrefetch}
      onFocus={item.onPrefetch}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
    >
      <Icon size={18} />
      {collapsed ? null : <span>{item.label}</span>}
    </NavLink>
  );
}
