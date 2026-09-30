import { describe, expect, it } from "vitest";
import { canSelectTaskModel } from "./taskModelSelection";

describe("canSelectTaskModel", () => {
  it("allows the normal selector for ChatGPT BYO without a forced model", () => {
    expect(canSelectTaskModel({ byo_enabled: true, byo_provider: "chatgpt_oauth", byo_forced_model: null })).toBe(true);
    expect(canSelectTaskModel({ byo_enabled: true, byo_provider: "chatgpt_oauth", byo_forced_model: "  " })).toBe(true);
  });

  it("hides the normal selector when BYO has a fixed model", () => {
    expect(canSelectTaskModel({ byo_enabled: true, byo_provider: "chatgpt_oauth", byo_forced_model: "gpt-5" })).toBe(false);
    expect(canSelectTaskModel({ byo_enabled: true, byo_provider: "openai_compatible", byo_forced_model: null })).toBe(false);
  });

  it("allows the selector for subscription users", () => {
    expect(canSelectTaskModel({ byo_enabled: false, byo_provider: null, byo_forced_model: null })).toBe(true);
    expect(canSelectTaskModel(null)).toBe(true);
  });
});
