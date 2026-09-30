export interface OnboardingDocsEntry {
  id: string;
  title: string;
  summary: string;
  checklistLabel: string;
  docsPath: string;
}

// This file is generated from docs frontmatter.
// Run `npm run docs:generate-onboarding-manifest` to refresh.
export const onboardingDocsManifest: Record<string, OnboardingDocsEntry> = {
  "agent-shells": {
    id: "agent-shells",
    title: "Agent shell sessions",
    summary: "Agents can keep shells and servers running in the background. See their output and stop them here.",
    checklistLabel: "Shell sessions",
    docsPath: "/core-workflows/agent-shells"
  },
  "connectors": {
    id: "connectors",
    title: "Connectors — Overview & Routing",
    summary: "Link Telegram, Discord, GitHub, and Email so tasks can flow through your tools.",
    checklistLabel: "Connectors",
    docsPath: "/core-workflows/connectors"
  },
  "create-project": {
    id: "create-project",
    title: "Open Your Project",
    summary: "Every new workspace starts with a project. Open it, rename it if needed, and create more later.",
    checklistLabel: "Open project",
    docsPath: "/getting-started/create-project"
  },
  "files-browser": {
    id: "files-browser",
    title: "Files Browser",
    summary: "Upload, preview, download, and open files in your project workspace.",
    checklistLabel: "Files browser",
    docsPath: "/core-workflows/files-browser"
  },
  "interactive-canvas": {
    id: "interactive-canvas",
    title: "Interactive Canvas",
    summary: "Build and refine persistent project websites with Meowbert.",
    checklistLabel: "Interactive Canvas",
    docsPath: "/core-workflows/interactive-canvas"
  },
  "notifications": {
    id: "notifications",
    title: "Notifications",
    summary: "Control browser or desktop alerts and review delivery status across workspace tasks.",
    checklistLabel: "Notifications",
    docsPath: "/core-workflows/notifications"
  },
  "project-master": {
    id: "project-master",
    title: "Project Master",
    summary: "Every project has a Master who coordinates tasks for you. You can still manage tasks yourself.",
    checklistLabel: "Project Master",
    docsPath: "/getting-started/project-master"
  },
  "project-overview": {
    id: "project-overview",
    title: "Project Overview",
    summary: "Track task status, filter history, and launch new work from one screen.",
    checklistLabel: "Project overview",
    docsPath: "/core-workflows/project-overview"
  },
  "scheduled-tasks": {
    id: "scheduled-tasks",
    title: "Scheduled, Infinite & Timed Tasks",
    summary: "Run a task on a schedule, keep it working in a loop, or give it a time budget, and get the results when it's done.",
    checklistLabel: "Scheduled tasks",
    docsPath: "/core-workflows/scheduled-tasks"
  },
  "task-composer": {
    id: "task-composer",
    title: "Task Composer",
    summary: "Write prompts, attach files, and enable tools before sending a task.",
    checklistLabel: "Task composer",
    docsPath: "/core-workflows/task-composer"
  },
  "task-follow-up": {
    id: "task-follow-up",
    title: "Task Follow-up",
    summary: "Continue a conversation, branch edits, and review assistant/tool output.",
    checklistLabel: "Task follow-ups",
    docsPath: "/core-workflows/task-follow-up"
  },
  "task-workflows": {
    id: "task-workflows",
    title: "Long Horizon, Deep Research, Quality control & Agent Swarm",
    summary: "When one agent is not enough, use Long Horizon, Deep Research, Quality control, or an Agent Swarm of several models working together.",
    checklistLabel: "Workflows & Agent Swarm",
    docsPath: "/core-workflows/task-workflows"
  },
  "welcome": {
    id: "welcome",
    title: "Welcome to Meowbert",
    summary: "Get oriented quickly, then work through the most common workflows.",
    checklistLabel: "Welcome",
    docsPath: "/getting-started/overview"
  },
  "workspace-memory": {
    id: "workspace-memory",
    title: "Workspace Memory",
    summary: "Keep durable notes in the workspace so agents remember your preferences, conventions, and decisions across tasks.",
    checklistLabel: "Memory",
    docsPath: "/core-workflows/workspace-memory"
  },
  "workspace-navigation": {
    id: "workspace-navigation",
    title: "Workspace Navigation",
    summary: "Switch workspaces and move through main product areas from the sidebar.",
    checklistLabel: "Workspace navigation",
    docsPath: "/getting-started/workspace-navigation"
  },
  "wrap-up": {
    id: "wrap-up",
    title: "Next Steps",
    summary: "You are ready. Keep the docs handy and restart tutorial anytime from Help.",
    checklistLabel: "Wrap-up",
    docsPath: "/getting-started/next-steps"
  },
};
