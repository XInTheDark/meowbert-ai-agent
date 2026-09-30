import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));

import { query } from "../../lib/db.js";
import { listSourceFileLinksUnderEnvironmentPaths } from "./store.js";

describe("source file link path queries", () => {
  it("matches directory prefixes literally instead of treating path characters as LIKE wildcards", async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);

    await listSourceFileLinksUnderEnvironmentPaths("environment-1", ["context/a_b", "context/100%"]);

    const [sql] = vi.mocked(query).mock.calls[0] ?? [];
    expect(sql).toContain("left(local_relative_path, length(requested.path) + 1) = requested.path || '/'");
    expect(sql).not.toContain("local_relative_path LIKE requested.path");
  });
});
