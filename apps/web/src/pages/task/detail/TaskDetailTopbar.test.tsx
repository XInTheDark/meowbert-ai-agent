/** @vitest-environment jsdom */

import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskDetailTopbar } from "./TaskDetailTopbar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedContainers: HTMLElement[] = [];

/** Renders into the DOM so popovers and disclosures can actually be opened. */
function renderTopbar(props: ComponentProps<typeof TaskDetailTopbar>): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <TaskDetailTopbar {...props} />
      </MemoryRouter>
    );
  });
  return container;
}

function click(element: Element | null): void {
  if (!element) {
    throw new Error("element not found");
  }
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  mountedContainers.splice(0).forEach((container) => container.remove());
});

function buildProps(overrides: Partial<ComponentProps<typeof TaskDetailTopbar>> = {}): ComponentProps<typeof TaskDetailTopbar> {
  return {
    task: {
      id: "task-1",
      title: "Mobile task header",
      status: "running",
      cancellation_requested: false,
      created_at: "2026-03-12T00:00:00.000Z",
      updated_at: "2026-03-12T00:00:00.000Z",
      source: "github",
      task_type: undefined,
      schedule: null
    },
    subtasks: [],
    isTaskRunning: true,
    isCompacting: false,
    isClearingContext: false,
    isScheduleActionBusy: false,
    topbarCollapsed: false,
    isMobileViewport: false,
    onExpandRequested: vi.fn(),
    activeTab: "conversation",
    onTabChange: vi.fn(),
    actionsMenuRef: { current: null },
    actionsMenuOpen: false,
    onActionsMenuToggle: vi.fn(),
    onViewFiles: vi.fn(),
    onOpenTaskFolder: vi.fn(),
    canOpenTaskFolder: false,
    onExportJson: vi.fn(),
    onExportMarkdown: vi.fn(),
    isExportingChat: false,
    onCompactContext: vi.fn(),
    onClearContext: vi.fn(),
    contextChipExpanded: false,
    onContextChipExpandedChange: vi.fn(),
    onPauseSchedule: vi.fn(),
    onResumeSchedule: vi.fn(),
    onRunNowSchedule: vi.fn(),
    onOpenSubtask: vi.fn(),
    latestContextUsage: null,
    messageDisplayPreferences: {
      collapseLongMessages: true,
      renderMarkdown: true,
      renderCommonHtml: true,
      hideCitationMarkers: true,
      renderUserMessages: false,
      renderLatex: true,
      allowSingleDollarLatex: false,
      showThoughts: true,
      showMessageSummaries: true,
      showScrollToBottomButton: true,
      showSelectionThreadActions: true,
      showSelectionThreadHighlights: true
    },
    onMessageDisplayPreferencesChange: vi.fn(),
    isMessageDisplayPreferencesSaving: false,
    isMessageOutlineOpen: true,
    onMessageOutlineToggle: vi.fn(),
    workflowPanel: null,
    ...overrides
  };
}

describe("TaskDetailTopbar", () => {
  it("keeps a context indicator visible before the provider reports usage", () => {
    const html = renderToStaticMarkup(<TaskDetailTopbar {...buildProps()} />);

    expect(html).toContain("Context —");
    expect(html).toContain("context-usage-pill unavailable");
  });

  it("shows the latest context usage in the top bar", () => {
    const html = renderToStaticMarkup(
      <TaskDetailTopbar
        {...buildProps({
          latestContextUsage: { usedTokens: 64_000, maxContextTokens: 256_000 }
        })}
      />
    );

    expect(html).toContain("Context 25%");
    expect(html).toContain("context-usage-pill-meter");
    expect(html).not.toContain("Context —");
  });

  it("renders a collapsed indicator strip for collapsed mobile topbars", () => {
    const html = renderToStaticMarkup(
      <TaskDetailTopbar {...buildProps({ isMobileViewport: true, topbarCollapsed: true })} />
    );

    expect(html).toContain('chat-task-topbar collapsed');
    expect(html).toContain('class="chat-task-topbar-collapsed-bar"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Show details");
    expect(html).toContain("lucide-chevron-right");
    expect(html).toContain("Mobile task header");
  });

  it("keeps the expanded state when the topbar is visible", () => {
    const html = renderToStaticMarkup(
      <TaskDetailTopbar {...buildProps({ isMobileViewport: true, topbarCollapsed: false })} />
    );

    expect(html).not.toContain('chat-task-topbar collapsed');
    expect(html).toContain('aria-expanded="true"');
  });

  it("renders a messages-panel toggle in the header actions", () => {
    const html = renderToStaticMarkup(
      <TaskDetailTopbar {...buildProps({ isMessageOutlineOpen: false, actionsMenuOpen: true })} />
    );

    expect(html).toContain("Show Messages");
    expect(html).toContain("task-outline-toggle-icon");
    expect(html).toContain('aria-pressed="false"');
  });

  it("shows chat export formats under one actions-menu entry", () => {
    const html = renderToStaticMarkup(
      <TaskDetailTopbar {...buildProps({ actionsMenuOpen: true })} />
    );

    expect(html).toContain("Export");
    expect(html).toContain("JSON");
    expect(html).toContain("Markdown");
    expect(html).toContain("topbar-dropdown-submenu");
    expect(html).toContain("lucide-download");
  });

  it("places clear context below compact context", () => {
    const html = renderToStaticMarkup(
      <TaskDetailTopbar {...buildProps({ actionsMenuOpen: true })} />
    );

    expect(html.indexOf("Compact Context")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Clear Context")).toBeGreaterThan(html.indexOf("Compact Context"));
  });

  it("groups display settings and toggles citation marker cleanup", () => {
    const onMessageDisplayPreferencesChange = vi.fn();
    const container = renderTopbar(buildProps({
      newMessageOrganizationEnabled: true,
      onMessageDisplayPreferencesChange
    }));

    click(container.querySelector('button[title="Display settings"]'));

    const menu = container.querySelector('[aria-label="Message display settings"]');
    expect(Array.from(menu?.querySelectorAll(".chat-tools-section-label") ?? []).map((label) => label.textContent))
      .toEqual(["Message layout", "Text rendering", "Text cleanup", "Conversation controls"]);
    const cleanupButton = Array.from(menu?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent?.includes("Hide citation markers"));
    expect(cleanupButton?.getAttribute("aria-checked")).toBe("true");

    click(cleanupButton ?? null);
    expect(onMessageDisplayPreferencesChange).toHaveBeenCalledWith({
      ...buildProps().messageDisplayPreferences,
      hideCitationMarkers: false
    });
  });

  it("renders the mobile navigation button next to the task title", () => {
    const html = renderToStaticMarkup(
      <TaskDetailTopbar {...buildProps({ isMobileViewport: true, onOpenMobileNavigation: vi.fn() })} />
    );

    expect(html).toContain("Open navigation");
    expect(html).toContain("task-topbar-mobile-nav-btn");
    expect(html).toContain("lucide-panel-left-open");
  });

  it("shows a timed-task start action instead of generic recurring controls", () => {
    const container = renderTopbar(
      buildProps({
          task: {
            ...buildProps().task,
            task_type: "timed",
            schedule: {
              mode: "infinite",
              state: "paused",
              repeat: null,
              timezone: "UTC",
              next_run_at: null,
              pending_run: false,
              run_timeout_seconds: 1800,
              run_deadline_at: null
            }
          }
      })
    );

    // Schedule detail stays behind the chip so it cannot push the conversation down.
    expect(container.querySelector(".task-schedule-popover")).toBeNull();
    expect(container.querySelector(".task-schedule-chip")?.textContent).toContain("paused");

    click(container.querySelector(".task-schedule-chip"));

    const popover = container.querySelector(".task-schedule-popover");
    expect(popover?.textContent).toContain("Timed run limit");
    expect(popover?.textContent).toContain("Start timed run");
    expect(popover?.textContent).not.toContain("Run now");
    expect(popover?.textContent).not.toContain("Resume");
    expect(popover?.textContent).not.toContain("Pause");
  });

  it("shows a timed-task stop action while the timed loop is active", () => {
    const container = renderTopbar(
      buildProps({
          task: {
            ...buildProps().task,
            task_type: "timed",
            schedule: {
              mode: "infinite",
              state: "active",
              repeat: null,
              timezone: "UTC",
              next_run_at: "2026-03-12T00:05:00.000Z",
              pending_run: false,
              run_timeout_seconds: 1800,
              run_deadline_at: "2026-03-12T00:30:00.000Z"
            }
          }
      })
    );

    click(container.querySelector(".task-schedule-chip"));

    const popover = container.querySelector(".task-schedule-popover");
    expect(popover?.textContent).toContain("Stop timed run");
    expect(popover?.textContent).toContain("Next wake-up");
    expect(popover?.textContent).toContain("Deadline");
    expect(popover?.textContent).not.toContain("Run now");
  });

  it("keeps subtasks behind a count chip until it is expanded", () => {
    const container = renderTopbar(
      buildProps({
        subtasks: [
          { id: "sub-1", title: "First subtask", status: "running", created_at: "2026-03-12T00:00:00.000Z", updated_at: "2026-03-12T00:00:00.000Z", completed_at: null },
          { id: "sub-2", title: "Second subtask", status: "succeeded", created_at: "2026-03-12T00:00:00.000Z", updated_at: "2026-03-12T00:00:00.000Z", completed_at: "2026-03-12T00:01:00.000Z" }
        ]
      })
    );

    const toggle = container.querySelector(".task-subtasks-toggle");
    expect(toggle?.textContent).toContain("2 subtasks");
    expect(container.querySelector(".task-subtasks-list")).toBeNull();

    click(toggle);

    const chips = container.querySelectorAll(".task-subtask-chip");
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain("First subtask");
  });

  it("opens a subtask from the expanded list", () => {
    const onOpenSubtask = vi.fn();
    const container = renderTopbar(
      buildProps({
        onOpenSubtask,
        subtasks: [
          { id: "sub-1", title: "First subtask", status: "running", created_at: "2026-03-12T00:00:00.000Z", updated_at: "2026-03-12T00:00:00.000Z", completed_at: null }
        ]
      })
    );

    click(container.querySelector(".task-subtasks-toggle"));
    click(container.querySelector(".task-subtask-chip"));

    expect(onOpenSubtask).toHaveBeenCalledWith("sub-1");
  });

  it("renders no subtask chip when the task has none", () => {
    const container = renderTopbar(buildProps());

    expect(container.querySelector(".task-subtasks-toggle")).toBeNull();
  });

  it("shows the created-shell tab after notifications and switches to it", () => {
    const onTabChange = vi.fn();
    const container = renderTopbar(buildProps({ persistentShellCount: 2, onTabChange }));
    const tabButtons = Array.from(container.querySelectorAll('[role="tab"]'));

    expect(tabButtons.map((button) => button.textContent?.trim())).toEqual([
      "Conversation",
      "Events",
      "Artifacts",
      "Notifications",
      "(2) shells created"
    ]);

    const shellTab = tabButtons.at(-1);
    expect(shellTab?.getAttribute("title")).toBe("(2) shells created");
    click(shellTab ?? null);
    expect(onTabChange).toHaveBeenCalledWith("shells");
  });

  it("renders the provided workflow panel inside the top bar", () => {
    const html = renderToStaticMarkup(
      <TaskDetailTopbar
        {...buildProps({
          workflowPanel: <div className="workflow-panel-test">Workflow panel body</div>
        })}
      />
    );

    expect(html).toContain("task-topbar-workflow-slot");
    expect(html).toContain("Workflow panel body");
  });
});
