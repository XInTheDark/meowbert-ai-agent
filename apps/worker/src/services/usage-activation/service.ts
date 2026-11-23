import { claimDueActivations, expireActivationClaims, finishActivation, getActivationProvider, type ActivationClaim } from "./store.js";
import { activationErrorMessage, sendActivationRequest } from "./request.js";
import { sendAntigravityActivationRequest } from "./antigravity-request.js";

async function executeActivation(claim: ActivationClaim): Promise<void> {
  let errorMessage: string | null = null;
  let skipped = false;
  try {
    const provider = await getActivationProvider(claim);
    if (!provider) {
      skipped = true;
    } else if ("targetType" in provider) {
      await sendAntigravityActivationRequest(provider.credentialIds, claim.model);
    } else {
      await sendActivationRequest(provider, claim.model);
    }
  } catch (error) {
    errorMessage = activationErrorMessage(error);
  }
  await finishActivation(claim, skipped ? "skipped" : errorMessage ? "failed" : "succeeded",
    skipped ? "Schedule changed or occurrence expired before the request started." : errorMessage);
}

export async function processDueActivations(): Promise<number> {
  await expireActivationClaims();
  const claims = await claimDueActivations();
  // Drain every result before the next poll or shutdown, including persistence failures.
  const results = await Promise.allSettled(claims.map(executeActivation));
  if (results.some((result) => result.status === "rejected")) throw new Error("Could not persist activation results.");
  return claims.length;
}

export function startUsageActivationLoop(): { stop: () => Promise<void> } {
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let pending: Promise<void> | null = null;
  const schedule = (delay: number): void => {
    if (stopping) return;
    timer = setTimeout(run, delay);
    timer.unref();
  };
  const run = (): void => {
    if (stopping) return;
    let delay = 15_000;
    pending = processDueActivations()
      .then((count) => { if (count === 10) delay = 0; })
      .catch(() => { console.error("Usage activation scheduler failed; it will retry on the next poll."); })
      .finally(() => { pending = null; schedule(delay); });
  };
  schedule(0);
  return { stop: async () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    await pending;
  } };
}
