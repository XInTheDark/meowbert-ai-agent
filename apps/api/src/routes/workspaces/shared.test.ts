import { describe, expect, it } from "vitest";
import { formatWorkspaceSettingsResponse, workspaceSettingsPatchSchema } from "./shared.js";

describe("workspace settings patch schema", () => {
  it("accepts runAsRoot on its own", () => {
    expect(workspaceSettingsPatchSchema.parse({ runAsRoot: true })).toEqual({ runAsRoot: true });
  });

  it("accepts thoughtPersistenceEnabled on its own", () => {
    expect(workspaceSettingsPatchSchema.parse({ thoughtPersistenceEnabled: false })).toEqual({
      thoughtPersistenceEnabled: false
    });
  });

  it("accepts sendMetadataToModel on its own", () => {
    expect(workspaceSettingsPatchSchema.parse({ sendMetadataToModel: true })).toEqual({
      sendMetadataToModel: true
    });
  });

  it("rejects the retired context management tools experiment", () => {
    expect(() => workspaceSettingsPatchSchema.parse({ contextManagementToolsEnabled: true })).toThrow();
  });

  it("accepts agent defaults fields on their own", () => {
    expect(workspaceSettingsPatchSchema.parse({ systemPrompt: "Use markdown." })).toEqual({
      systemPrompt: "Use markdown."
    });
    expect(workspaceSettingsPatchSchema.parse({ personalityId: "friendly" })).toEqual({
      personalityId: "friendly"
    });
    expect(workspaceSettingsPatchSchema.parse({ sandboxNetworkEnabled: null })).toEqual({
      sandboxNetworkEnabled: null
    });
    expect(workspaceSettingsPatchSchema.parse({
      defaultToolset: {
        webSearch: false,
        scheduleTask: true,
        enabledSkills: ["html-canvas"]
      }
    })).toEqual({
      defaultToolset: {
        webSearch: false,
        scheduleTask: true,
        enabledSkills: ["html-canvas"]
      }
    });
  });
});

describe("workspace settings response formatter", () => {
  it("includes the runAsRoot flag and active experiments", () => {
    expect(formatWorkspaceSettingsResponse({}, false, true)).toMatchObject({
      systemPrompt: "",
      personalityId: null,
      sandboxNetworkEnabled: null,
      effectiveSandboxNetworkEnabled: true,
      defaultToolset: {
        webSearch: true,
        memorySearch: false,
        scheduleTask: true,
        subtasks: false,
        computerUse: false,
        enabledSkills: ["html-canvas"],
        enabledSources: []
      },
      memoryEnabled: false,
      nativeCompactionEnabled: true,
      contextCompactionBackend: "native",
      sendMetadataToModel: false,
      thoughtPersistenceEnabled: true,
      runAsRoot: true
    });
  });

  it("reflects explicit experiment overrides", () => {
    expect(formatWorkspaceSettingsResponse({
      contextCompactionBackend: "summary",
      sendMetadataToModel: true,
      thoughtPersistenceEnabled: false
    }, true, false)).toMatchObject({
      memoryEnabled: true,
      nativeCompactionEnabled: false,
      contextCompactionBackend: "summary",
      sendMetadataToModel: true,
      thoughtPersistenceEnabled: false,
      runAsRoot: false
    });
  });

  it("reflects configured workspace agent defaults", () => {
    expect(formatWorkspaceSettingsResponse({
      default_context: {
        system_prompt: "Use markdown.",
        personality: "friendly"
      },
      sandbox: {
        network_enabled: false
      },
      default_toolset: {
        webSearch: false,
        memorySearch: true,
        scheduleTask: false,
        subtasks: true,
        enabledSkills: ["custom"]
      }
    }, true, false)).toMatchObject({
      systemPrompt: "Use markdown.",
      personalityId: "friendly",
      effectivePersonalityId: "friendly",
      sandboxNetworkEnabled: false,
      effectiveSandboxNetworkEnabled: false,
      defaultToolset: {
        webSearch: false,
        memorySearch: false,
        scheduleTask: false,
        subtasks: true,
        computerUse: false,
        enabledSkills: ["custom"],
        enabledSources: []
      }
    });
  });
});
