import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminTable, AdminTableCell, AdminTableRow } from "./AdminTable";

describe("AdminTable", () => {
  it("renders shared table chrome with aligned columns", () => {
    const html = renderToStaticMarkup(
      <AdminTable
        columns={[
          { key: "name", label: "Name" },
          { key: "actions", label: "Actions", align: "right" }
        ]}
      >
        <AdminTableRow>
          <AdminTableCell>Alpha</AdminTableCell>
          <AdminTableCell align="right">Edit</AdminTableCell>
        </AdminTableRow>
      </AdminTable>
    );

    expect(html).toContain("admin-table");
    expect(html).toContain("admin-table__cell--right");
    expect(html).toContain("Alpha");
    expect(html).toContain("Actions");
  });
});
