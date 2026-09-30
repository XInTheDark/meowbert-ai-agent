import { ChevronLeft } from "lucide-react";
import { BrandMark } from "../../lib/brand";

interface SidebarBrandHeaderProps {
  isRail: boolean;
  onCollapse: () => void;
}

export function SidebarBrandHeader({ isRail, onCollapse }: SidebarBrandHeaderProps) {
  return (
    <div className="brand-block sidebar-brand-block">
      <div className="sidebar-brand-main">
        <BrandMark className="brand-mark" title="Meowbert" themeAware />
        {isRail ? null : (
          <div className="sidebar-brand-title">
            <strong>Meowbert</strong>
          </div>
        )}
      </div>
      {isRail ? null : (
        <button
          className="btn ghost icon-btn sidebar-collapse-btn"
          type="button"
          onClick={onCollapse}
          title="Collapse Sidebar"
          aria-label="Collapse Sidebar"
        >
          <ChevronLeft size={18} />
        </button>
      )}
    </div>
  );
}
