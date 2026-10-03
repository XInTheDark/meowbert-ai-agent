import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_TYPE,
  DEFAULT_MAX_CONTEXT_WINDOW_TOKENS,
  normalizePlatformModelMetadata,
  resolveCodeModeForModel,
  resolveCompatibilityModesForModel,
  resolveContextManagementVersionForModel,
  resolveContextWindowForModel,
  resolveModelTypeForModel
} from "./model-metadata.js";

describe("normalizePlatformModelMetadata", () => {
  it("falls back to the default metadata when raw value is invalid", () => {
    expect(normalizePlatformModelMetadata(null)).toEqual({
      default: {
        context_window: DEFAULT_MAX_CONTEXT_WINDOW_TOKENS,
        type: DEFAULT_MODEL_TYPE
      }
    });
  });

  it("preserves extra metadata while normalizing context window values", () => {
    expect(
      normalizePlatformModelMetadata({
        default: {
          context_window: "128000",
          label: "Default",
          type: "google"
        },
        "gpt-5.4": {
          context_window: 1_000_000,
          family: "gpt-5",
          type: "openai"
        },
        ignored: [1, 2, 3]
      })
    ).toEqual({
      default: {
        context_window: 128_000,
        label: "Default",
        type: "google"
      },
      "gpt-5.4": {
        context_window: 1_000_000,
        family: "gpt-5",
        type: "openai"
      }
    });
  });

  it("defaults and validates model provider types", () => {
    expect(
      normalizePlatformModelMetadata({
        default: {
          context_window: 128000,
          type: "invalid"
        },
        "gemini-2.5-pro": {
          type: "google"
        }
      })
    ).toEqual({
      default: {
        context_window: 128_000,
        type: "openai"
      },
      "gemini-2.5-pro": {
        type: "google"
      }
    });
  });

  it("accepts gemini as an alias for the Google provider type", () => {
    expect(
      normalizePlatformModelMetadata({
        default: {
          context_window: 128000,
          type: "openai"
        },
        "gemini-2.5-pro": {
          type: "gemini"
        }
      })
    ).toEqual({
      default: {
        context_window: 128_000,
        type: "openai"
      },
      "gemini-2.5-pro": {
        type: "google"
      }
    });
  });

  it("normalizes supported compatibility modes", () => {
    expect(
      normalizePlatformModelMetadata({
        default: {
          context_window: 128000,
          compatibility: [
            "noSystemMessages",
            "noDeveloperMessages",
            "forceFixDoubleResponse",
            "disablePdfFile",
            "unknown",
            "noSystemMessages"
          ]
        },
        "gpt-5.4": {
          compatibility: []
        },
        "claude-opus-4-7": {
          compatibility: ["noDeveloperMessages", "forceFixDoubleResponse", "unknown"]
        }
      })
    ).toEqual({
      default: {
        context_window: 128_000,
        compatibility: ["noSystemMessages", "noDeveloperMessages", "forceFixDoubleResponse", "disablePdfFile"],
        type: "openai"
      },
      "gpt-5.4": {
        compatibility: []
      },
      "claude-opus-4-7": {
        compatibility: ["noDeveloperMessages", "forceFixDoubleResponse"]
      }
    });
  });
});

describe("resolveContextWindowForModel", () => {
  const metadata = {
    default: {
      context_window: 256_000,
      type: "openai"
    },
    "gpt-5.4": {
      context_window: 1_000_000
    }
  };

  it("prefers exact model matches", () => {
    expect(resolveContextWindowForModel("gpt-5.4", metadata)).toBe(1_000_000);
  });

  it("falls back to the default entry", () => {
    expect(resolveContextWindowForModel("unknown-model", metadata)).toBe(256_000);
  });

  it("falls back to the hard default when default entry is invalid", () => {
    expect(resolveContextWindowForModel("gpt-5.4", { default: { context_window: "bad" } })).toBe(
      DEFAULT_MAX_CONTEXT_WINDOW_TOKENS
    );
  });
});

describe("resolveContextManagementVersionForModel", () => {
  it("defaults to V2 and lets an exact model retain V1", () => {
    const metadata = {
      default: { context_management: "v2" },
      "legacy-model": { context_management: "v1" },
      invalid: { context_management: "nope" }
    };
    expect(resolveContextManagementVersionForModel("new-model", metadata)).toBe("v2");
    expect(resolveContextManagementVersionForModel("legacy-model", metadata)).toBe("v1");
    expect(resolveContextManagementVersionForModel("invalid", metadata)).toBe("v2");
  });

  it("uses V2 when old metadata has no context-management field", () => {
    expect(resolveContextManagementVersionForModel("gpt-5", { default: { context_window: 256_000 } })).toBe("v2");
  });
});

describe("resolveCodeModeForModel", () => {
  it("is on by default and can be turned off per model or for every model", () => {
    expect(resolveCodeModeForModel("gpt-5", { default: { context_window: 256_000 } })).toBe(true);
    expect(resolveCodeModeForModel("small-model", { "small-model": { code_mode: false } })).toBe(false);
    expect(resolveCodeModeForModel("gpt-5", { default: { code_mode: false }, "gpt-5": { code_mode: true } })).toBe(true);
    expect(resolveCodeModeForModel("other", { default: { code_mode: false } })).toBe(false);
    expect(resolveCodeModeForModel("invalid", { invalid: { code_mode: "no" } })).toBe(true);
  });
});

describe("resolveModelTypeForModel", () => {
  const metadata = {
    default: {
      context_window: 256_000,
      type: "openai"
    },
    "gemini-2.5-pro": {
      context_window: 1_000_000,
      type: "google"
    }
  };

  it("prefers exact model type matches", () => {
    expect(resolveModelTypeForModel("gemini-2.5-pro", metadata)).toBe("google");
  });

  it("resolves gemini metadata aliases to the Google provider type", () => {
    expect(resolveModelTypeForModel("gemini-2.5-pro", {
      default: {
        context_window: 256_000,
        type: "openai"
      },
      "gemini-2.5-pro": {
        type: "gemini"
      }
    })).toBe("google");
  });

  it("falls back to the default model type", () => {
    expect(resolveModelTypeForModel("unknown-model", {
      default: {
        context_window: 256_000,
        type: "google"
      }
    })).toBe("google");
  });

  it("uses openai when metadata does not declare a model type", () => {
    expect(resolveModelTypeForModel("unknown-model", { default: { context_window: 256_000 } })).toBe("openai");
  });
});

describe("resolveCompatibilityModesForModel", () => {
  const metadata = {
    default: {
      compatibility: ["forceFixDoubleResponse"]
    },
    "gpt-5.4": {
      compatibility: []
    },
    "gpt-5.4-mini": {
      compatibility: ["noSystemMessages"]
    },
    "gpt-5.4-no-pdf": {
      compatibility: ["disablePdfFile"]
    },
    "claude-opus-4-7": {
      compatibility: ["noDeveloperMessages", "forceFixDoubleResponse"]
    }
  };

  it("prefers exact model compatibility matches", () => {
    expect(resolveCompatibilityModesForModel("gpt-5.4-mini", metadata)).toEqual(["noSystemMessages"]);
  });

  it("falls back to the default compatibility modes", () => {
    expect(resolveCompatibilityModesForModel("unknown-model", metadata)).toEqual(["forceFixDoubleResponse"]);
  });

  it("allows exact model entries to disable default compatibility modes", () => {
    expect(resolveCompatibilityModesForModel("gpt-5.4", metadata)).toEqual([]);
  });

  it("resolves the correctly spelled compatibility key", () => {
    expect(resolveCompatibilityModesForModel("claude-opus-4-7", metadata)).toEqual([
      "noDeveloperMessages",
      "forceFixDoubleResponse"
    ]);
  });

  it("resolves the disablePdfFile compatibility mode", () => {
    expect(resolveCompatibilityModesForModel("gpt-5.4-no-pdf", metadata)).toEqual(["disablePdfFile"]);
  });
});
