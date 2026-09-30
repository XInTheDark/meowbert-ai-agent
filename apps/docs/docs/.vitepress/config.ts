import { defineConfig } from "vitepress";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveDesktopReleaseEnv } = require("../../../../config/desktop-release.cjs");
const desktopReleaseEnv = resolveDesktopReleaseEnv();

function normalizeAllowedHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0] ?? null;
  }
}

function getAllowedHosts(): string[] {
  return [
    process.env.VITE_ALLOWED_HOSTS,
    process.env.SERVICE_FQDN_DOCS,
    process.env.SERVICE_URL_DOCS,
    process.env.COOLIFY_FQDN
  ]
    .flatMap((value) => (value ?? "").split(","))
    .map((host) => normalizeAllowedHost(host))
    .filter((host): host is string => Boolean(host));
}

const allowedHosts = getAllowedHosts();

export default defineConfig({
  title: "Meowbert Docs",
  description: "Install, use, and self-host Meowbert.",
  cleanUrls: true,
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }]],
  vite: {
    define: {
      "import.meta.env.VITE_DESKTOP_RELEASE_REPOSITORY": JSON.stringify(desktopReleaseEnv.env.VITE_DESKTOP_RELEASE_REPOSITORY),
      "import.meta.env.VITE_DESKTOP_RELEASES_PAGE_URL": JSON.stringify(desktopReleaseEnv.env.VITE_DESKTOP_RELEASES_PAGE_URL)
    },
    server: {
      allowedHosts
    },
    preview: {
      allowedHosts
    }
  },
  themeConfig: {
    logo: "/brand-mark.svg",
    nav: [
      { text: "Quickstart", link: "/getting-started/quickstart" },
      { text: "Using Meowbert", link: "/getting-started/overview" },
      { text: "Self-Hosting", link: "/self-hosting/configuration" },
      { text: "Reference", link: "/reference/tool-options" }
    ],
    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What You Can Count On", link: "/introduction/principles" },
          { text: "System Requirements", link: "/introduction/requirements" },
          { text: "Known Limitations", link: "/introduction/limitations" },
          { text: "Quickstart", link: "/getting-started/quickstart" }
        ]
      },
      {
        text: "Getting Started",
        items: [
          { text: "Overview", link: "/getting-started/overview" },
          { text: "Workspace Navigation", link: "/getting-started/workspace-navigation" },
          { text: "Open Your Project", link: "/getting-started/create-project" },
          { text: "Project Master", link: "/getting-started/project-master" },
          { text: "Desktop App", link: "/getting-started/desktop-app" },
          { text: "Next Steps", link: "/getting-started/next-steps" }
        ]
      },
      {
        text: "Projects",
        items: [
          { text: "Project Overview", link: "/core-workflows/project-overview" },
          { text: "Files Browser", link: "/core-workflows/files-browser" },
          { text: "Interactive Canvas", link: "/core-workflows/interactive-canvas" },
          { text: "Agent Shell Sessions", link: "/core-workflows/agent-shells" }
        ]
      },
      {
        text: "Tasks",
        items: [
          { text: "Task Composer", link: "/core-workflows/task-composer" },
          { text: "Task Follow-up", link: "/core-workflows/task-follow-up" },
          { text: "Scheduled & Infinite Tasks", link: "/core-workflows/scheduled-tasks" },
          { text: "Workflows & Agent Swarm", link: "/core-workflows/task-workflows" },
          { text: "Notifications", link: "/core-workflows/notifications" }
        ]
      },
      {
        text: "AI & Agents",
        items: [
          { text: "Agents & Personalities", link: "/core-workflows/agents-and-personalities" },
          { text: "Workspace Memory", link: "/core-workflows/workspace-memory" },
          { text: "Context Compaction", link: "/core-workflows/context-compaction" },
          { text: "Bring Your Own Provider", link: "/core-workflows/byo-providers" },
          { text: "Computer Use", link: "/core-workflows/computer-use" }
        ]
      },
      {
        text: "Connectors",
        items: [
          { text: "Overview & Routing", link: "/core-workflows/connectors" },
          { text: "Telegram", link: "/core-workflows/connectors-telegram" },
          { text: "Discord", link: "/core-workflows/connectors-discord" },
          { text: "GitHub", link: "/core-workflows/connectors-github" },
          { text: "Email", link: "/core-workflows/connectors-email" }
        ]
      },
      {
        text: "Self-Hosting",
        items: [
          { text: "Configuration", link: "/self-hosting/configuration" },
          { text: "Models & Providers", link: "/self-hosting/models-and-providers" },
          { text: "Sandbox & Security", link: "/self-hosting/sandbox-security" },
          { text: "Users & Sign-ups", link: "/self-hosting/users-and-signups" },
          { text: "Custom Skills", link: "/self-hosting/custom-skills" },
          { text: "Backups & Upgrades", link: "/self-hosting/backups-and-upgrades" },
          { text: "Outgoing Email", link: "/reference/email-delivery" },
          { text: "Inbound Email", link: "/core-workflows/connectors-email-inbound-admin" },
          { text: "Sources", link: "/reference/sources-admin-setup" },
          { text: "Storage Backends", link: "/reference/storage-backends" },
          { text: "XFS Project Quotas", link: "/reference/xfs-project-quotas" },
          { text: "Scheduled Usage Activation", link: "/core-workflows/scheduled-usage-activation" },
          { text: "Example: Coolify", link: "/reference/coolify-runtime-storage" }
        ]
      },
      {
        text: "Reference",
        items: [
          { text: "Tool Options", link: "/reference/tool-options" },
          { text: "Skills", link: "/reference/skills" },
          { text: "Common Issues", link: "/troubleshooting/common-issues" }
        ]
      }
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/XInTheDark/meowbert-ai-agent" }]
  }
});
