import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENVIRONMENT_PERSONALITY_ID,
  NEURAL_ENVIRONMENT_PERSONALITY_ID,
  NONE_ENVIRONMENT_PERSONALITY_ID,
  listPersonalityOptions,
  loadNeuralPersonalityPrompt,
  loadPersonalityPromptCatalog,
  resolveEnvironmentPersonalityId
} from "./personality-prompts.js";

describe("personality prompt catalog", () => {
  it("loads personalities from prompt-texts/personality directory", () => {
    const catalog = loadPersonalityPromptCatalog({ forceReload: true });
    const ids = catalog.entries.map((entry) => entry.id);

    expect(ids).toContain("default");
    expect(ids).toContain("concise");
    expect(ids).toContain(NEURAL_ENVIRONMENT_PERSONALITY_ID);
    expect(ids).toContain("none");
    expect(catalog.byId.get("default")?.promptText.length ?? 0).toBeGreaterThan(0);
  });

  it("loads Neural as a channel-only internal communication style", () => {
    const catalog = loadPersonalityPromptCatalog({ forceReload: true });
    const options = listPersonalityOptions(catalog);
    const promptText = loadNeuralPersonalityPrompt();

    expect(options.find((option) => option.id === NEURAL_ENVIRONMENT_PERSONALITY_ID)?.label).toBe("Neural");
    expect(promptText).toBe(catalog.byId.get(NEURAL_ENVIRONMENT_PERSONALITY_ID)?.promptText);
  });

  it("maps ids to display labels", () => {
    const catalog = loadPersonalityPromptCatalog({ forceReload: true });
    const options = listPersonalityOptions(catalog);
    const defaultOption = options.find((option) => option.id === "default");

    expect(defaultOption?.label).toBe("Default");
  });
});

describe("resolveEnvironmentPersonalityId", () => {
  it("returns requested id when available", () => {
    const catalog = loadPersonalityPromptCatalog({ forceReload: true });

    expect(
      resolveEnvironmentPersonalityId({
        requestedId: "concise",
        catalog
      })
    ).toBe("concise");
  });

  it("falls back to configured default id when request is invalid", () => {
    const catalog = loadPersonalityPromptCatalog({ forceReload: true });

    expect(
      resolveEnvironmentPersonalityId({
        requestedId: "missing",
        catalog,
        defaultId: DEFAULT_ENVIRONMENT_PERSONALITY_ID
      })
    ).toBe(DEFAULT_ENVIRONMENT_PERSONALITY_ID);
  });

  it("falls back to none when default is unavailable", () => {
    const catalog = {
      entries: [
        { id: NONE_ENVIRONMENT_PERSONALITY_ID, promptText: "" },
        { id: "friendly", promptText: "be friendly" }
      ],
      byId: new Map([
        [NONE_ENVIRONMENT_PERSONALITY_ID, { id: NONE_ENVIRONMENT_PERSONALITY_ID, promptText: "" }],
        ["friendly", { id: "friendly", promptText: "be friendly" }]
      ])
    };

    expect(
      resolveEnvironmentPersonalityId({
        requestedId: "missing",
        catalog
      })
    ).toBe(NONE_ENVIRONMENT_PERSONALITY_ID);
  });
});
