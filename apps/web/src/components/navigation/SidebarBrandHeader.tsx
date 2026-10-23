import { PanelLeft } from "lucide-react";
import { BrandMark } from "../../lib/brand";

interface SidebarBrandHeaderProps {
  onHide: () => void;
}

export function SidebarBrandHeader({ onHide }: SidebarBrandHeaderProps) {
  return (
    <div className="brand-block sidebar-brand-block">
      <div className="sidebar-brand-main">
        <BrandMark className="brand-mark" title="Meowbert" themeAware />
        <div className="sidebar-brand-title">
          <strong>Meowbert</strong>
        </div>
      </div>
      <button
        className="icon-btn sidebar-toggle-btn sidebar-collapse-btn"
        type="button"
        onClick={onHide}
        title="Hide Sidebar"
        aria-label="Hide Sidebar"
      >
        <PanelLeft size={18} />
      </button>
    </div>
  );
}
