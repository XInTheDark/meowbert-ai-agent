import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskDetailEventsPane } from "./TaskDetailEventsPane";

describe("TaskDetailEventsPane", () => {
  it("renders model routing events with requested/resolved models and reasoning details", () => {
    const html = renderToStaticMarkup(
      <TaskDetailEventsPane
        events={[
          {
            id: "evt-1",
            type: "model_routed",
            createdAt: "2026-03-19T00:00:00.000Z",
            payload: {
              requestedModel: "router-v1",
              resolvedModel: "gpt-5.4",
              routingModel: "gpt-5.4-mini",
              reasoningEffort: "xhigh",
              reasoningScore: 82,
              reason: "Complex task.",
              cached: false,
              usedFallback: false
            }
          }
        ]}
        isBootstrapping={false}
        isPageLoading={false}
        eventsFeedRef={{ current: null }}
        onScroll={() => undefined}
      />
    );

    expect(html).toContain("Model routed");
    expect(html).toContain("router-v1");
    expect(html).toContain("gpt-5.4");
    expect(html).toContain("gpt-5.4-mini");
    expect(html).toContain("score 82");
    expect(html).toContain("Complex task.");
  });

  it("renders debug log events with stage and phase chips", () => {
    const html = renderToStaticMarkup(
      <TaskDetailEventsPane
        events={[
          {
            id: "evt-2",
            type: "log",
            createdAt: "2026-04-04T00:00:00.000Z",
            payload: {
              message: "Resolving workspace root.",
              stage: "startup.workspace_root",
              phase: "start",
              durationMs: 125
            }
          }
        ]}
        isBootstrapping={false}
        isPageLoading={false}
        eventsFeedRef={{ current: null }}
        onScroll={() => undefined}
      />
    );

    expect(html).toContain("Log");
    expect(html).toContain("startup.workspace_root");
    expect(html).toContain("start");
    expect(html).toContain("Resolving workspace root.");
    expect(html).toContain("125ms");
  });

  it("renders a copy-events button", () => {
    const html = renderToStaticMarkup(
      <TaskDetailEventsPane
        events={[
          {
            id: "evt-3",
            type: "log",
            createdAt: "2026-04-04T00:00:00.000Z",
            payload: {
              message: "Debug log"
            }
          }
        ]}
        isBootstrapping={false}
        isPageLoading={false}
        eventsFeedRef={{ current: null }}
        onScroll={() => undefined}
      />
    );

    expect(html).toContain("Copy events");
    expect(html).toContain("events-copy-btn");
  });

  it("renders a copy-request button for network request replay events", () => {
    const html = renderToStaticMarkup(
      <TaskDetailEventsPane
        events={[
          {
            id: "evt-4",
            type: "log",
            createdAt: "2026-04-07T00:00:00.000Z",
            payload: {
              message: "Sending payload: POST https://api.openai.com/v1/responses (attempt 1)",
              networkRequest: {
                phase: "start",
                service: "openai_responses",
                endpoint: "responses.create",
                model: "gpt-5.4",
                baseUrl: "https://api.openai.com/v1",
                attempt: 1,
                request: {
                  method: "POST",
                  url: "https://api.openai.com/v1/responses",
                  headers: {
                    authorization: "Bearer <REPLACE_WITH_API_KEY>"
                  },
                  body: {
                    model: "gpt-5.4",
                    stream: true
                  },
                  curl: "curl ..."
                }
              }
            }
          }
        ]}
        isBootstrapping={false}
        isPageLoading={false}
        eventsFeedRef={{ current: null }}
        onScroll={() => undefined}
      />
    );

    expect(html).toContain("Copy request");
    expect(html).toContain("https://api.openai.com/v1/responses");
    expect(html).toContain("POST");
  });
});
