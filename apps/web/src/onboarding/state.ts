import { OnboardingProgressRecord } from "./storage";

interface OnboardingDecisionInput {
  serverCompletedAt: string | null | undefined;
  localProgress: OnboardingProgressRecord | null;
  totalSteps: number;
}

export interface OnboardingDecision {
  shouldAutoStart: boolean;
  shouldOfferResume: boolean;
  initialStepIndex: number;
}

function clampStepIndex(index: number, totalSteps: number): number {
  if (totalSteps <= 0) {
    return 0;
  }

  return Math.min(Math.max(index, 0), totalSteps - 1);
}

export function deriveOnboardingDecision(input: OnboardingDecisionInput): OnboardingDecision {
  if (input.serverCompletedAt) {
    return {
      shouldAutoStart: false,
      shouldOfferResume: false,
      initialStepIndex: 0
    };
  }

  const local = input.localProgress;
  if (!local || local.status === "not_started") {
    return {
      shouldAutoStart: true,
      shouldOfferResume: false,
      initialStepIndex: 0
    };
  }

  if (local.status === "completed") {
    return {
      shouldAutoStart: false,
      shouldOfferResume: false,
      initialStepIndex: 0
    };
  }

  return {
    shouldAutoStart: false,
    shouldOfferResume: true,
    initialStepIndex: clampStepIndex(local.stepIndex, input.totalSteps)
  };
}
