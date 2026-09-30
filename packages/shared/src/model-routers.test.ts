import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_MODEL_ROUTERS,
  findPlatformModelRouterById,
  normalizePlatformModelRouters,
  resolvePlatformModelRouterDefaultRuntimeModel,
  resolvePlatformModelRouterTargetRuntimeModel
} from "./model-routers.js";

describe("normalizePlatformModelRouters", () => {
  it("falls back to the built-in router when raw config is missing or invalid", () => {
    expect(normalizePlatformModelRouters(null)).toEqual(DEFAULT_PLATFORM_MODEL_ROUTERS);
    expect(normalizePlatformModelRouters({})).toEqual(DEFAULT_PLATFORM_MODEL_ROUTERS);
    expect(normalizePlatformModelRouters([{ id: "bad" }])).toEqual(DEFAULT_PLATFORM_MODEL_ROUTERS);
  });

  it("preserves an explicit empty array so admins can disable routers entirely", () => {
    expect(normalizePlatformModelRouters([])).toEqual([]);
  });

  it("normalizes routers, deduplicates ids, and falls back default target to the first model", () => {
    expect(
      normalizePlatformModelRouters([
        {
          id: " Router-V1 ",
          routingModel: " gpt-5.4-mini ",
          defaultTargetModel: "unknown",
          models: [
            {
              id: "gpt-5.4",
              description: "Use for hard tasks.",
              payload: {
                model: "gpt-5.4",
                reasoning: {
                  effort: "xhigh"
                }
              }
            },
            {
              id: "gpt-5.4-mini",
              description: "Use for quick tasks."
            },
            {
              id: "gpt-5.4",
              description: "duplicate"
            }
          ]
        },
        {
          id: "router-v1",
          routingModel: "gpt-other",
          defaultTargetModel: "gpt-other",
          models: [
            {
              id: "gpt-other",
              description: "ignored duplicate router"
            }
          ]
        }
      ])
    ).toEqual([
      {
        id: "router-v1",
        routingModel: "gpt-5.4-mini",
        defaultTargetModel: "gpt-5.4",
        allowQuickMode: false,
        models: [
          {
            id: "gpt-5.4",
            description: "Use for hard tasks.",
            payload: {
              model: "gpt-5.4",
              responses: {
                reasoning: {
                  effort: "xhigh"
                }
              }
            }
          },
          {
            id: "gpt-5.4-mini",
            description: "Use for quick tasks.",
            payload: {
              model: "gpt-5.4-mini"
            }
          }
        ]
      }
    ]);
  });

  it("resolves runtime models from target payloads instead of target ids", () => {
    const [router] = normalizePlatformModelRouters([
      {
        id: "router-v1",
        routingModel: "gpt-router",
        defaultTargetModel: "hard",
        models: [
          {
            id: "hard",
            description: "Use for hard tasks.",
            payload: {
              model: "gpt-5.5"
            }
          }
        ]
      }
    ]);

    expect(router).toBeDefined();
    expect(resolvePlatformModelRouterTargetRuntimeModel(router!, "hard")).toBe("gpt-5.5");
    expect(resolvePlatformModelRouterDefaultRuntimeModel(router!)).toBe("gpt-5.5");
  });

  it("normalizes allowQuickMode as an explicit router flag", () => {
    const [router] = normalizePlatformModelRouters([
      {
        id: "router-v1",
        routingModel: "gpt-router",
        defaultTargetModel: "fast",
        allowQuickMode: true,
        models: [
          {
            id: "fast",
            description: "Use for quick tasks.",
            payload: {
              model: "gpt-5.4-mini"
            }
          }
        ]
      }
    ]);

    expect(router?.allowQuickMode).toBe(true);
  });
});

describe("findPlatformModelRouterById", () => {
  const routers = normalizePlatformModelRouters([
    {
      id: "router-v1",
      routingModel: "gpt-5.4-mini",
      defaultTargetModel: "gpt-5.4-mini",
      allowQuickMode: false,
      models: [
        {
          id: "gpt-5.4",
          description: "Use for hard tasks.",
          payload: {
            model: "gpt-5.4"
          }
        },
        {
          id: "gpt-5.4-mini",
          description: "Use for quick tasks.",
          payload: {
            model: "gpt-5.4-mini"
          }
        }
      ]
    }
  ]);

  it("matches router ids case-insensitively and returns a clone", () => {
    const match = findPlatformModelRouterById(routers, " Router-V1 ");
    expect(match).toEqual({
      id: "router-v1",
      routingModel: "gpt-5.4-mini",
      defaultTargetModel: "gpt-5.4-mini",
      allowQuickMode: false,
      models: [
        {
          id: "gpt-5.4",
          description: "Use for hard tasks.",
          payload: {
            model: "gpt-5.4"
          }
        },
        {
          id: "gpt-5.4-mini",
          description: "Use for quick tasks.",
          payload: {
            model: "gpt-5.4-mini"
          }
        }
      ]
    });

    if (!match) {
      throw new Error("Expected router match");
    }
    match.models[0].description = "changed";

    expect(routers[0]?.models[0]?.description).toBe("Use for hard tasks.");
  });

  it("returns null when the router is unknown", () => {
    expect(findPlatformModelRouterById(routers, "router-v2")).toBeNull();
  });
});
