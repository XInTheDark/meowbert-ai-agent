import { OnboardingDocsEntry, onboardingDocsManifest } from "./generatedDocsManifest";

export type OnboardingPlacement = "auto" | "center" | "bottom" | "top" | "right" | "left";

export type OnboardingSectionId = "basics" | "files" | "away" | "power";

export const ONBOARDING_SECTIONS: ReadonlyArray<{ id: OnboardingSectionId; title: string }> = [
  { id: "basics", title: "The basics" },
  { id: "files", title: "Files & memory" },
  { id: "away", title: "While you're away" },
  { id: "power", title: "Power features" }
];

export interface OnboardingRouteContext {
  workspaceId: string;
  environmentId: string | null;
}

interface OnboardingStepDefinition {
  id: keyof typeof onboardingDocsManifest;
  section: OnboardingSectionId;
  targetSelector: string | null;
  placement?: OnboardingPlacement;
  route: (context: OnboardingRouteContext) => string;
  requiresEnvironment?: boolean;
}

export interface OnboardingResolvedStep extends OnboardingDocsEntry {
  section: OnboardingSectionId;
  targetSelector: string | null;
  placement: OnboardingPlacement;
  route: (context: OnboardingRouteContext) => string;
  requiresEnvironment: boolean;
}

function workspaceBasePath(workspaceId: string): string {
  return `/app/${workspaceId}`;
}

function environmentBasePath(context: OnboardingRouteContext): string {
  if (!context.environmentId) {
    return `${workspaceBasePath(context.workspaceId)}/projects`;
  }

  return `${workspaceBasePath(context.workspaceId)}/projects/${context.environmentId}`;
}

function environmentRoute(context: OnboardingRouteContext, suffix: string): string {
  if (!context.environmentId) {
    return `${workspaceBasePath(context.workspaceId)}/projects`;
  }

  return `${environmentBasePath(context)}${suffix}`;
}

const STEP_DEFINITIONS: OnboardingStepDefinition[] = [
  {
    id: "welcome",
    section: "basics",
    targetSelector: null,
    placement: "center",
    route: (context) => `${workspaceBasePath(context.workspaceId)}/projects`
  },
  {
    id: "workspace-navigation",
    section: "basics",
    targetSelector: "[data-onboarding-id=\"workspace-switcher\"]",
    placement: "right",
    route: (context) => `${workspaceBasePath(context.workspaceId)}/projects`
  },
  {
    id: "create-project",
    section: "basics",
    targetSelector: null,
    placement: "center",
    route: (context) => `${workspaceBasePath(context.workspaceId)}/projects`
  },
  {
    id: "project-overview",
    section: "basics",
    targetSelector: "[data-onboarding-id=\"project-overview\"]",
    placement: "bottom",
    route: (context) => environmentRoute(context, "/tasks"),
    requiresEnvironment: true
  },
  {
    id: "task-composer",
    section: "basics",
    targetSelector: "[data-onboarding-id=\"task-composer-input\"]",
    placement: "top",
    route: (context) => environmentRoute(context, "/tasks/new"),
    requiresEnvironment: true
  },
  {
    id: "task-follow-up",
    section: "basics",
    targetSelector: null,
    placement: "center",
    route: (context) => environmentRoute(context, "/tasks/new"),
    requiresEnvironment: true
  },
  {
    id: "files-browser",
    section: "files",
    targetSelector: "[data-onboarding-id=\"files-toolbar\"]",
    placement: "bottom",
    route: (context) => environmentRoute(context, "/files"),
    requiresEnvironment: true
  },
  {
    id: "workspace-memory",
    section: "files",
    targetSelector: null,
    placement: "center",
    route: (context) => environmentRoute(context, "/files"),
    requiresEnvironment: true
  },
  {
    id: "scheduled-tasks",
    section: "away",
    targetSelector: null,
    placement: "center",
    route: (context) => environmentRoute(context, "/tasks/new"),
    requiresEnvironment: true
  },
  {
    id: "project-master",
    section: "away",
    targetSelector: null,
    placement: "center",
    route: (context) => environmentBasePath(context),
    requiresEnvironment: true
  },
  {
    id: "connectors",
    section: "away",
    targetSelector: "[data-onboarding-id=\"connectors-header\"]",
    placement: "bottom",
    route: (context) => `${workspaceBasePath(context.workspaceId)}/connectors`
  },
  {
    id: "notifications",
    section: "away",
    targetSelector: "[data-onboarding-id=\"notifications-header\"]",
    placement: "bottom",
    route: (context) => `${workspaceBasePath(context.workspaceId)}/notifications`
  },
  {
    id: "task-workflows",
    section: "power",
    targetSelector: null,
    placement: "center",
    route: (context) => environmentRoute(context, "/tasks/new"),
    requiresEnvironment: true
  },
  {
    id: "interactive-canvas",
    section: "power",
    targetSelector: null,
    placement: "center",
    route: (context) => environmentBasePath(context),
    requiresEnvironment: true
  },
  {
    id: "agent-shells",
    section: "power",
    targetSelector: null,
    placement: "center",
    route: (context) => environmentBasePath(context),
    requiresEnvironment: true
  },
  {
    id: "wrap-up",
    section: "power",
    targetSelector: null,
    placement: "center",
    route: (context) => `${workspaceBasePath(context.workspaceId)}/projects`
  }
];

export function getOnboardingResolvedSteps(): OnboardingResolvedStep[] {
  return STEP_DEFINITIONS.map((definition) => {
    const docsEntry = onboardingDocsManifest[definition.id];
    if (!docsEntry) {
      throw new Error(`Missing onboarding docs entry for step ${definition.id}`);
    }

    return {
      ...docsEntry,
      section: definition.section,
      targetSelector: definition.targetSelector,
      placement: definition.placement ?? "auto",
      route: definition.route,
      requiresEnvironment: definition.requiresEnvironment ?? false
    };
  });
}

export function findNextSectionStepIndex(steps: OnboardingResolvedStep[], currentIndex: number): number {
  const currentSection = steps[currentIndex]?.section;
  const nextIndex = steps.findIndex((step, index) => index > currentIndex && step.section !== currentSection);
  return nextIndex === -1 ? steps.length : nextIndex;
}
