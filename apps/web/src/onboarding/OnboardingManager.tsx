import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import Joyride, { ACTIONS, EVENTS, STATUS, CallBackProps, Step } from "react-joyride";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiClient } from "../lib/api";
import { Environment, FlashMessage, UserProfile } from "../lib/types";
import {
  OnboardingProgressStatus,
  createOnboardingProgressRecord,
  readOnboardingProgress,
  writeOnboardingProgress
} from "./storage";
import { deriveOnboardingDecision } from "./state";
import { findNextSectionStepIndex, getOnboardingResolvedSteps } from "./steps";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { OnboardingStepBody } from "./OnboardingStepBody";

interface OnboardingManagerProps {
  api: ApiClient;
  user: UserProfile | null;
  activeWorkspaceId: string;
  activeEnvironmentId: string | null;
  environments: Environment[];
  setFlash: (flash: FlashMessage | null) => void;
  deferAutoStart?: boolean;
  children: ReactNode;
}

interface OnboardingContextValue {
  hasInProgressTutorial: boolean;
  isTutorialRunning: boolean;
  openTutorial: () => void;
  restartTutorial: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function clampStepIndex(index: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.min(Math.max(0, index), total - 1);
}

export function OnboardingManager(props: OnboardingManagerProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const steps = useMemo(() => getOnboardingResolvedSteps(), []);
  const createEnvironmentStepIndex = useMemo(
    () => steps.findIndex((step) => step.id === "create-project"),
    [steps]
  );
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [resumeStepIndex, setResumeStepIndex] = useState(0);
  const [hasInProgressTutorial, setHasInProgressTutorial] = useState(false);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [joyrideMountNonce, setJoyrideMountNonce] = useState(0);
  const lastTargetNotFoundKeyRef = useRef<string | null>(null);

  const preferredEnvironmentId = useMemo(() => {
    if (props.activeEnvironmentId) {
      return props.activeEnvironmentId;
    }

    return props.environments.find((environment) => environment.status === "active")?.id ?? null;
  }, [props.activeEnvironmentId, props.environments]);

  const routeContext = useMemo(
    () => ({
      workspaceId: props.activeWorkspaceId,
      environmentId: preferredEnvironmentId
    }),
    [preferredEnvironmentId, props.activeWorkspaceId]
  );

  const persistProgress = useCallback(
    (status: OnboardingProgressStatus, nextStepIndex: number, workspaceId: string | null) => {
      if (!props.user?.id) {
        return;
      }

      writeOnboardingProgress(
        props.user.id,
        createOnboardingProgressRecord({
          status,
          stepIndex: nextStepIndex,
          lastWorkspaceId: workspaceId
        })
      );
    },
    [props.user?.id]
  );

  const setTutorialStepIndex = useCallback(
    (nextIndex: number) => {
      const clampedIndex = clampStepIndex(nextIndex, steps.length);
      setStepIndex(clampedIndex);
      setResumeStepIndex(clampedIndex);
      persistProgress("in_progress", clampedIndex, props.activeWorkspaceId || null);
      return clampedIndex;
    },
    [persistProgress, props.activeWorkspaceId, steps.length]
  );

  const resolveBlockedStepIndex = useCallback(
    (nextIndex: number) => {
      const clampedIndex = clampStepIndex(nextIndex, steps.length);
      const nextStep = steps[clampedIndex];
      if (!nextStep) {
        return clampedIndex;
      }
      if (!nextStep.requiresEnvironment || preferredEnvironmentId) {
        return clampedIndex;
      }
      if (createEnvironmentStepIndex >= 0) {
        return createEnvironmentStepIndex;
      }
      return clampedIndex;
    },
    [createEnvironmentStepIndex, preferredEnvironmentId, steps]
  );

  const startTutorial = useCallback(() => {
    const nextIndex = 0;
    setStepIndex(nextIndex);
    setResumeStepIndex(nextIndex);
    setHasInProgressTutorial(true);
    setShowResumePrompt(false);
    setRun(true);
    persistProgress("in_progress", nextIndex, props.activeWorkspaceId || null);
  }, [persistProgress, props.activeWorkspaceId]);

  const resumeTutorial = useCallback(() => {
    const nextIndex = clampStepIndex(resumeStepIndex, steps.length);
    setStepIndex(nextIndex);
    setHasInProgressTutorial(true);
    setShowResumePrompt(false);
    setRun(true);
    persistProgress("in_progress", nextIndex, props.activeWorkspaceId || null);
  }, [persistProgress, props.activeWorkspaceId, resumeStepIndex, steps.length]);

  const pauseTutorial = useCallback(
    (index: number) => {
      const pausedIndex = clampStepIndex(index, steps.length);
      setRun(false);
      setStepIndex(pausedIndex);
      setResumeStepIndex(pausedIndex);
      setHasInProgressTutorial(true);
      setShowResumePrompt(true);
      persistProgress("in_progress", pausedIndex, props.activeWorkspaceId || null);
    },
    [persistProgress, props.activeWorkspaceId, steps.length]
  );

  const completeTutorial = useCallback(async () => {
    const completedIndex = steps.length > 0 ? steps.length - 1 : 0;
    setRun(false);
    setShowResumePrompt(false);

    try {
      await props.api.post<{ onboardingCompletedAt: string }>("/api/auth/onboarding/complete", {});
      setHasInProgressTutorial(false);
      setResumeStepIndex(completedIndex);
      persistProgress("completed", completedIndex, props.activeWorkspaceId || null);
      props.setFlash({ tone: "success", text: "Tutorial completed. You can restart it from Help anytime." });
    } catch (err) {
      pauseTutorial(completedIndex);
      props.setFlash({
        tone: "error",
        text:
          err instanceof Error
            ? `Saved locally, but failed to sync completion: ${err.message}`
            : "Saved locally, but failed to sync completion."
      });
    }
  }, [pauseTutorial, persistProgress, props.activeWorkspaceId, props.api, props.setFlash, steps.length]);

  useEffect(() => {
    if (!props.user?.id) {
      setRun(false);
      setStepIndex(0);
      setResumeStepIndex(0);
      setHasInProgressTutorial(false);
      setShowResumePrompt(false);
      return;
    }

    const localProgress = readOnboardingProgress(props.user.id);

    if (props.user.onboarding_completed_at) {
      setRun(false);
      setStepIndex(0);
      setResumeStepIndex(0);
      setHasInProgressTutorial(false);
      setShowResumePrompt(false);
      persistProgress("completed", steps.length > 0 ? steps.length - 1 : 0, props.activeWorkspaceId || null);
      return;
    }

    const decision = deriveOnboardingDecision({
      serverCompletedAt: props.user.onboarding_completed_at,
      localProgress,
      totalSteps: steps.length
    });

    setStepIndex(decision.initialStepIndex);
    setResumeStepIndex(decision.initialStepIndex);
    setHasInProgressTutorial(decision.shouldOfferResume);
    setShowResumePrompt(decision.shouldOfferResume);

    if (decision.shouldAutoStart && !props.deferAutoStart) {
      setRun(true);
      persistProgress("in_progress", decision.initialStepIndex, props.activeWorkspaceId || null);
      return;
    }

    setRun(false);
  }, [
    persistProgress,
    props.deferAutoStart,
    props.user?.id,
    props.user?.onboarding_completed_at,
    steps.length
  ]);

  useEffect(() => {
    if (!run || !props.activeWorkspaceId) {
      return;
    }

    const clampedIndex = clampStepIndex(stepIndex, steps.length);
    const currentIndex = resolveBlockedStepIndex(clampedIndex);
    if (currentIndex !== clampedIndex) {
      setTutorialStepIndex(currentIndex);
      return;
    }

    const currentStep = steps[currentIndex];
    if (!currentStep) {
      return;
    }

    const expectedPath = currentStep.route(routeContext);
    if (location.pathname !== expectedPath) {
      navigate(expectedPath);
    }
  }, [location.pathname, navigate, props.activeWorkspaceId, resolveBlockedStepIndex, routeContext, run, setTutorialStepIndex, stepIndex, steps]);

  const skipSection = useCallback(
    (currentIndex: number) => {
      const nextIndex = findNextSectionStepIndex(steps, currentIndex);
      if (nextIndex >= steps.length) {
        void completeTutorial();
        return;
      }
      setTutorialStepIndex(resolveBlockedStepIndex(nextIndex));
    },
    [completeTutorial, resolveBlockedStepIndex, setTutorialStepIndex, steps]
  );

  const joyrideSteps = useMemo<Step[]>(
    () =>
      steps.map((step, index) => ({
        target: step.targetSelector ?? "body",
        title: step.title,
        content: <OnboardingStepBody steps={steps} stepIndex={index} onSkipSection={() => skipSection(index)} />,
        placement: step.placement,
        disableBeacon: true,
        spotlightPadding: 8
      })),
    [skipSection, steps]
  );

  const handleJoyrideCallback = useCallback(
    (data: CallBackProps) => {
      const { action, index, status, type } = data;

      if (status === STATUS.FINISHED) {
        void completeTutorial();
        return;
      }

      if (status === STATUS.SKIPPED) {
        pauseTutorial(index);
        return;
      }

      const currentIndex = clampStepIndex(index, steps.length);
      const currentStep = steps[currentIndex];

      if (type === EVENTS.TARGET_NOT_FOUND) {
        const blockedIndex = resolveBlockedStepIndex(currentIndex);
        if (blockedIndex !== currentIndex) {
          setTutorialStepIndex(blockedIndex);
          props.setFlash({
            tone: "success",
            text: "Open a project first, or create one if you do not have one yet."
          });
          return;
        }

        const expectedPath = currentStep?.route(routeContext);
        if (expectedPath && location.pathname !== expectedPath) {
          navigate(expectedPath);
        }

        const retryKey = `${currentIndex}:${location.pathname}`;
        if (lastTargetNotFoundKeyRef.current !== retryKey) {
          lastTargetNotFoundKeyRef.current = retryKey;
          // Force one remount for this step/path so Joyride can rebind after route/layout updates.
          window.setTimeout(() => {
            setJoyrideMountNonce((value) => value + 1);
          }, 120);
        }
        return;
      }

      if (type !== EVENTS.STEP_AFTER) {
        return;
      }

      if (action !== ACTIONS.PREV && currentStep?.id === "create-project" && !preferredEnvironmentId) {
        setTutorialStepIndex(currentIndex);
        props.setFlash({
          tone: "success",
          text: "Open a project first, then click Next to continue."
        });
        return;
      }

      const delta = action === ACTIONS.PREV ? -1 : 1;
      const nextIndex = currentIndex + delta;

      if (nextIndex >= steps.length) {
        void completeTutorial();
        return;
      }

      const resolvedNextIndex = resolveBlockedStepIndex(nextIndex);
      setTutorialStepIndex(resolvedNextIndex);
      if (resolvedNextIndex !== nextIndex) {
        props.setFlash({
          tone: "success",
          text: "This step needs a project. Open one first, or create one if needed."
        });
      }
    },
    [
      completeTutorial,
      pauseTutorial,
      preferredEnvironmentId,
      routeContext,
      location.pathname,
      navigate,
      props.setFlash,
      resolveBlockedStepIndex,
      setTutorialStepIndex,
      steps
    ]
  );

  const contextValue = useMemo<OnboardingContextValue>(
    () => ({
      hasInProgressTutorial,
      isTutorialRunning: run,
      openTutorial: hasInProgressTutorial ? resumeTutorial : startTutorial,
      restartTutorial: startTutorial
    }),
    [hasInProgressTutorial, resumeTutorial, run, startTutorial]
  );

  return (
    <OnboardingContext.Provider value={contextValue}>
      {props.children}

      {showResumePrompt && !run ? (
        <aside
          style={{
            position: "fixed",
            right: "1rem",
            bottom: "1rem",
            width: "min(360px, calc(100vw - 2rem))",
            borderRadius: "0.85rem",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-lg)",
            padding: "0.9rem",
            zIndex: 4000,
            display: "grid",
            gap: "0.75rem"
          }}
        >
          <div style={{ display: "grid", gap: "0.35rem" }}>
            <strong>Resume onboarding?</strong>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.86rem", lineHeight: 1.5 }}>
              You started the Meowbert tutorial. Continue where you left off, or restart from the beginning.
            </p>
          </div>
          <OnboardingChecklist steps={steps} currentIndex={resumeStepIndex} maxHeight="170px" />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className="btn primary" type="button" onClick={resumeTutorial}>
              Resume tutorial
            </button>
            <button className="btn ghost" type="button" onClick={startTutorial}>
              Restart
            </button>
            <button className="btn ghost" type="button" onClick={() => setShowResumePrompt(false)}>
              Dismiss
            </button>
          </div>
        </aside>
      ) : null}

      <Joyride
        key={`${location.pathname}:${joyrideMountNonce}`}
        run={run}
        stepIndex={stepIndex}
        continuous
        showSkipButton
        showProgress
        disableScrolling={false}
        scrollToFirstStep
        steps={joyrideSteps}
        callback={handleJoyrideCallback}
        locale={{
          back: "Back",
          close: "Close",
          last: "Finish",
          next: "Next",
          skip: "Pause"
        }}
        styles={{
          options: {
            zIndex: 5000,
            arrowColor: "var(--surface)",
            backgroundColor: "var(--surface)",
            primaryColor: "var(--brand-strong)",
            textColor: "var(--text)"
          },
          buttonNext: {
            borderRadius: 6
          },
          buttonBack: {
            color: "var(--text-muted)"
          }
        }}
      />
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingManager");
  }
  return context;
}
