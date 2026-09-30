import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

interface ExplorerTableProps {
  children: ReactNode;
  className?: string;
  columns?: string;
  style?: CSSProperties;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}

interface ExplorerRowProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  draggable?: boolean;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}

interface ExplorerCellProps {
  children?: ReactNode;
  className?: string;
  align?: "left" | "center" | "right";
  title?: string;
}

interface ExplorerCheckboxProps {
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  ariaLabel: string;
  onChange?: (checked: boolean) => void;
  onClick?: (event: MouseEvent<HTMLInputElement>) => void;
}

interface ExplorerSortButtonProps {
  children: ReactNode;
  active?: boolean;
  direction?: "asc" | "desc";
  indicator?: ReactNode;
  onClick: () => void;
}

interface ExplorerRowActionButtonProps {
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}

export function ExplorerTable(props: ExplorerTableProps) {
  const style = props.columns
    ? { ...props.style, "--explorer-columns": props.columns } as CSSProperties
    : props.style;

  return (
    <div
      className={`explorer-table ${props.className ?? ""}`}
      style={style}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
    >
      {props.children}
    </div>
  );
}

export function ExplorerHeader(props: { children: ReactNode; className?: string }) {
  return <div className={`explorer-row explorer-header ${props.className ?? ""}`}>{props.children}</div>;
}

export function ExplorerBody(props: { children: ReactNode; className?: string }) {
  return <div className={`explorer-body ${props.className ?? ""}`}>{props.children}</div>;
}

export function ExplorerRow(props: ExplorerRowProps) {
  return (
    <div
      className={`explorer-row ${props.className ?? ""}`}
      style={props.style}
      title={props.title}
      draggable={props.draggable}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
    >
      {props.children}
    </div>
  );
}

export function ExplorerCell(props: ExplorerCellProps) {
  const alignClass = props.align ? `explorer-cell-${props.align}` : "";
  return (
    <div className={`explorer-cell ${alignClass} ${props.className ?? ""}`} title={props.title}>
      {props.children}
    </div>
  );
}

export function ExplorerCheckbox(props: ExplorerCheckboxProps) {
  return (
    <input
      type="checkbox"
      className="explorer-checkbox"
      checked={props.checked}
      disabled={props.disabled}
      ref={(node) => {
        if (node) {
          node.indeterminate = props.indeterminate === true;
        }
      }}
      aria-label={props.ariaLabel}
      onClick={props.onClick}
      onChange={(event) => props.onChange?.(event.target.checked)}
    />
  );
}

export function ExplorerSortButton(props: ExplorerSortButtonProps) {
  const indicator = props.indicator ?? (props.active ? (props.direction === "asc" ? "↑" : "↓") : "↕");
  return (
    <button className="explorer-sort-button" type="button" onClick={props.onClick}>
      <span>{props.children}</span>
      <span className="explorer-sort-indicator">{indicator}</span>
    </button>
  );
}

export function ExplorerRowActionButton(props: ExplorerRowActionButtonProps) {
  return (
    <button
      className="btn ghost icon-btn explorer-row-action-button"
      type="button"
      disabled={props.disabled}
      title={props.title ?? "Actions"}
      aria-label={props.title ?? "Actions"}
      onClick={props.onClick}
    >
      <MoreHorizontal size={15} />
    </button>
  );
}
