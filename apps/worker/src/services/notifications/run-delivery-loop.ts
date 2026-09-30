import { deliverPendingRuns } from "./run-delivery.js";

let wake: (() => void) | null = null;
export function wakeRunDeliveryLoop(): void { wake?.(); }

export function startRunDeliveryLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let rerun = false;
  let timer: NodeJS.Timeout | null = null;
  let pending: Promise<void> | null = null;
  const schedule = (delay: number): void => {
    if (stopping) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; run(); }, delay);
    timer.unref();
  };
  const run = (): void => {
    if (stopping || pending) return;
    let delay = 60_000;
    pending = deliverPendingRuns()
      .then((count) => { if (count === 20) delay = 5_000; })
      .catch((error) => { console.error("Run delivery recovery failed", error); })
      .finally(() => {
        pending = null;
        schedule(rerun ? 0 : delay);
        rerun = false;
      });
  };
  wake = () => { if (pending) rerun = true; else schedule(0); };
  schedule(0);
  return { stop: async () => {
    stopping = true;
    wake = null;
    if (timer) clearTimeout(timer);
    await pending;
  } };
}
