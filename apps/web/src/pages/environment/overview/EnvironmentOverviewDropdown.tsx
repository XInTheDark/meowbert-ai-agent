import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";

function dropdownItemStyle(disabled?: boolean, danger?: boolean): CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "6px 14px",
    background: "none",
    border: "none",
    cursor: disabled ? "default" : "pointer",
    fontSize: "0.875rem",
    color: disabled ? "var(--text-muted)" : danger ? "var(--danger, #e05)" : "var(--text)",
    opacity: disabled ? 0.6 : 1
  };
}

export function DropdownItem({
  children,
  onClick,
  disabled,
  danger
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={dropdownItemStyle(disabled, danger)}>
      {children}
    </button>
  );
}

// A real link so modified clicks (ctrl/cmd, middle) open the destination in a new tab.
export function DropdownLinkItem({
  children,
  to,
  onClick
}: {
  children: ReactNode;
  to: string;
  onClick?: () => void;
}) {
  return (
    <Link to={to} role="menuitem" onClick={onClick} style={dropdownItemStyle()}>
      {children}
    </Link>
  );
}

export function DropdownDivider() {
  return <div style={{ height: "1px", background: "var(--border)", margin: "4px 0" }} />;
}
