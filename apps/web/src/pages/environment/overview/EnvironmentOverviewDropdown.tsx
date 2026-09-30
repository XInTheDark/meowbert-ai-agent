import type { ReactNode } from "react";

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
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
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
      }}
    >
      {children}
    </button>
  );
}

export function DropdownDivider() {
  return <div style={{ height: "1px", background: "var(--border)", margin: "4px 0" }} />;
}
