// Static captures finish finite animations; looping animations use the end of their first cycle.
// Cancelling animations would restore the hidden base styles of entrance effects.
export async function freezeHtmlCanvasAnimations(page) {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const timing = animation.effect?.getComputedTiming();
      if (!timing) continue;
      if (Number.isFinite(timing.endTime)) {
        animation.currentTime = Math.max(0, timing.endTime - 0.001);
      } else if (typeof timing.duration === "number" && Number.isFinite(timing.duration)) {
        animation.currentTime = Math.max(0, timing.delay + timing.duration - 0.001);
      }
      animation.pause();
    }
  });
}
