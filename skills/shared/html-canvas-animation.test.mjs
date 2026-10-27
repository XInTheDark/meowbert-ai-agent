import { afterEach, expect, it, vi } from "vitest";
import { freezeHtmlCanvasAnimations } from "./html-canvas-animation.mjs";
afterEach(() => vi.unstubAllGlobals());
it("freezes finite and looping animations without cancelling their visible frame", async () => {
  const finite = { effect: { getComputedTiming: () => ({ endTime: 3000 }) }, pause: vi.fn() };
  const loop = { effect: { getComputedTiming: () => ({ endTime: Infinity, delay: 200, duration: 1000 }) }, pause: vi.fn() };
  vi.stubGlobal("document", { getAnimations: () => [finite, loop] });
  await freezeHtmlCanvasAnimations({ evaluate: (operation) => operation() });
  expect(finite.currentTime).toBeCloseTo(2999.999);
  expect(loop.currentTime).toBeCloseTo(1199.999);
  expect(finite.pause).toHaveBeenCalledOnce();
  expect(loop.pause).toHaveBeenCalledOnce();
});
