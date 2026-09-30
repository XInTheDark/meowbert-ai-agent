import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import { TaskConversationSearchPanel } from "./TaskConversationSearchPanel";

function createApi(): ApiClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    postForm: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
  };
}

describe("TaskConversationSearchPanel", () => {
  it("renders a close button on desktop sidebars", () => {
    const html = renderToStaticMarkup(
      <TaskConversationSearchPanel
        api={createApi()}
        taskId="task-1"
        activeLeafMessageId={null}
        chatFeedRef={{ current: null }}
        isMobileDrawer={false}
        onResultSelected={() => undefined}
        onSelectedResultChange={() => undefined}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain("Close search");
    expect(html).toContain("task-search-panel-close-btn");
  });
});
