import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_DEFAULT_TOOLSET,
  extractWorkspaceEnvironmentDefaults,
  getPersistentRuntimeEnabled,
  getSandboxNetworkEnabledOverride,
  getWorkspaceDefaultToolset,
  getWorkspacePersonalityId,
  getWorkspaceSystemPrompt,
  setWorkspaceDefaultToolset,
  resolveEffectiveEnvironmentJsonPayload,
  setSandboxNetworkEnabledOverride,
  setPersistentRuntimeEnabled,
  setWorkspacePersonalityId,
  setWorkspaceSystemPrompt
} from "./workspace-agent-settings.js";

describe("workspace agent settings helpers", () => {
  it("reads and writes workspace system prompts", () => {
    const updated = setWorkspaceSystemPrompt({}, "Stay concise.");
    expect(getWorkspaceSystemPrompt(updated)).toBe("Stay concise.");
    expect(updated).toEqual({
      default_context: {
        system_prompt: "Stay concise."
      }
    });

    expect(setWorkspaceSystemPrompt(updated, null)).toEqual({});
  });

  it("reads and writes workspace personality ids", () => {
    const updated = setWorkspacePersonalityId({}, "Friendly");
    expect(getWorkspacePersonalityId(updated)).toBe("friendly");
    expect(updated).toEqual({
      default_context: {
        personality: "friendly"
      }
    });

    expect(setWorkspacePersonalityId(updated, null)).toEqual({});
  });

  it("supports nullable sandbox network overrides", () => {
    const blocked = setSandboxNetworkEnabledOverride({}, false);
    expect(getSandboxNetworkEnabledOverride(blocked)).toBe(false);
    expect(blocked).toEqual({
      sandbox: {
        network_enabled: false
      }
    });

    const allowed = setSandboxNetworkEnabledOverride(blocked, true);
    expect(getSandboxNetworkEnabledOverride(allowed)).toBe(true);
    expect(allowed).toEqual({
      sandbox: {
        network_enabled: true
      }
    });

    expect(setSandboxNetworkEnabledOverride(allowed, null)).toEqual({});
  });

  it("defaults persistent project runtimes on while preserving an explicit opt-out", () => {
    expect(getPersistentRuntimeEnabled({})).toBe(true);

    const disabled = setPersistentRuntimeEnabled({}, false);
    expect(disabled).toEqual({ persistent_runtime: { enabled: false } });
    expect(getPersistentRuntimeEnabled(disabled)).toBe(false);

    const enabled = setPersistentRuntimeEnabled(disabled, true);
    expect(enabled).toEqual({ persistent_runtime: { enabled: true } });
    expect(getPersistentRuntimeEnabled(enabled)).toBe(true);
  });

  it("defaults workspace toolsets to Canvas, web search, and schedule tasks", () => {
    expect(getWorkspaceDefaultToolset({})).toEqual(DEFAULT_WORKSPACE_DEFAULT_TOOLSET);
  });

  it("reads and writes workspace toolset defaults without taking over memory", () => {
    const updated = setWorkspaceDefaultToolset({}, {
      webSearch: false,
      memorySearch: true,
      scheduleTask: false,
      subtasks: true,
      computerUse: true,
      enabledSkills: [" html-canvas ", "custom-skill", "html-canvas", ""],
      enabledSources: ["source-a", "source-a"]
    });

    expect(getWorkspaceDefaultToolset(updated)).toEqual({
      webSearch: false,
      memorySearch: false,
      scheduleTask: false,
      subtasks: true,
      computerUse: true,
      interactiveCanvas: false,
      enabledSkills: ["html-canvas", "custom-skill"],
      enabledSources: ["source-a"]
    });
    expect(updated).toEqual({
      default_toolset: {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: true,
        computerUse: true,
        interactiveCanvas: false,
        enabledSkills: ["html-canvas", "custom-skill"],
        enabledSources: ["source-a"]
      }
    });
  });

  it("extracts only workspace environment default keys from workspace model defaults", () => {
    expect(
      extractWorkspaceEnvironmentDefaults({
        defaultModel: "gpt-5.4",
        shellToolMaxTimeoutMs: 60000,
        default_context: {
          system_prompt: "Use markdown.",
          personality: "friendly"
        },
        sandbox: {
          network_enabled: false
        }
      })
    ).toEqual({
      default_context: {
        system_prompt: "Use markdown.",
        personality: "friendly"
      },
      sandbox: {
        network_enabled: false
      }
    });
  });

  it("applies workspace defaults when environment overrides are absent", () => {
    expect(
      resolveEffectiveEnvironmentJsonPayload({
        workspaceModelDefaults: {
          default_context: {
            system_prompt: "Use markdown.",
            personality: "friendly"
          },
          sandbox: {
            network_enabled: false
          }
        },
        environmentPayload: {
          responses: {
            store: false
          }
        }
      })
    ).toEqual({
      responses: {
        store: false
      },
      default_context: {
        system_prompt: "Use markdown.",
        personality: "friendly"
      },
      sandbox: {
        network_enabled: false
      }
    });
  });

  it("appends environment system prompt while overriding personality and sandbox network", () => {
    expect(
      resolveEffectiveEnvironmentJsonPayload({
        workspaceModelDefaults: {
          default_context: {
            system_prompt: "Use markdown.",
            personality: "friendly"
          },
          sandbox: {
            network_enabled: false
          }
        },
        environmentPayload: {
          default_context: {
            system_prompt: "Include examples.",
            personality: "cold"
          },
          sandbox: {
            network_enabled: true
          },
          debug: {
            log_network_requests: true
          }
        }
      })
    ).toEqual({
      default_context: {
        system_prompt: "Use markdown.\n\nInclude examples.",
        personality: "cold"
      },
      sandbox: {
        network_enabled: true
      },
      debug: {
        log_network_requests: true
      }
    });
  });
});
