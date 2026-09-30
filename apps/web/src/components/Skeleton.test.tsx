/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Skeleton, SkeletonRegion } from "./Skeleton";
import { TaskListSkeleton } from "./tasks/TaskListSkeleton";

describe("Skeleton", () => {
  it("hides individual placeholders from assistive technology", () => {
    const html = renderToStaticMarkup(<Skeleton width="4rem" />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("skeleton");
    expect(html).toContain("width:4rem");
  });

  it("renders a circle variant", () => {
    expect(renderToStaticMarkup(<Skeleton circle />)).toContain("skeleton-circle");
  });

  it("announces the region once instead of each placeholder", () => {
    const html = renderToStaticMarkup(
      <SkeletonRegion label="Loading things">
        <Skeleton />
        <Skeleton />
      </SkeletonRegion>
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading things"');
  });
});

describe("TaskListSkeleton", () => {
  it("renders the requested number of placeholder rows", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<TaskListSkeleton rows={4} />);

    expect(container.querySelectorAll(".task-list-skeleton-row").length).toBe(4);
    expect(container.querySelector('[aria-label="Loading tasks"]')).not.toBeNull();
  });

  it("defaults to a full-looking list", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<TaskListSkeleton />);

    expect(container.querySelectorAll(".task-list-skeleton-row").length).toBe(6);
  });
});
