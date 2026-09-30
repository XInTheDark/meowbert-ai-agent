import type { ReactNode } from "react";

export interface AdminTableColumn {
  key: string;
  label: ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
}

function alignClassName(align: AdminTableColumn["align"] | undefined): string {
  if (align === "center") {
    return "admin-table__cell--center";
  }

  if (align === "right") {
    return "admin-table__cell--right";
  }

  return "";
}

export function AdminTable(props: {
  columns: AdminTableColumn[];
  children: ReactNode;
  minWidth?: number | string;
}) {
  const minWidth = typeof props.minWidth === "number" ? `${props.minWidth}px` : (props.minWidth ?? "760px");

  return (
    <div className="table-container">
      <table className="admin-table" style={{ minWidth }}>
        <thead>
          <tr className="admin-table__row admin-table__row--header">
            {props.columns.map((column) => (
              <th
                key={column.key}
                className={`admin-table__cell admin-table__cell--header ${alignClassName(column.align)}`.trim()}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

export function AdminTableRow(props: {
  children: ReactNode;
}) {
  return <tr className="admin-table__row">{props.children}</tr>;
}

export function AdminTableCell(props: {
  children: ReactNode;
  align?: "left" | "center" | "right";
  width?: string;
  colSpan?: number;
  verticalAlign?: "top" | "middle" | "bottom";
}) {
  return (
    <td
      className={`admin-table__cell ${alignClassName(props.align)}`.trim()}
      style={{
        ...(props.width ? { width: props.width } : {}),
        ...(props.verticalAlign ? { verticalAlign: props.verticalAlign } : {})
      }}
      colSpan={props.colSpan}
    >
      {props.children}
    </td>
  );
}
