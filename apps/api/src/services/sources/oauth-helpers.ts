import { createHash, randomBytes } from "node:crypto";
import { config } from "../../lib/config.js";

export const DESKTOP_SOURCE_RETURN_ORIGIN = "desktop://meowbert";

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function buildPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(48));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateSourceOauthState(): string {
  return randomBytes(24).toString("hex");
}

export function normalizeSourceReturnOrigin(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return config.web?.appUrl?.trim() || config.server.publicUrl;
  }

  if (trimmed === DESKTOP_SOURCE_RETURN_ORIGIN) {
    return DESKTOP_SOURCE_RETURN_ORIGIN;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch {
    return config.web?.appUrl?.trim() || config.server.publicUrl;
  }
}

export function buildWorkspaceSourcesUiUrl(
  returnOrigin: string,
  workspaceId: string,
  status?: "success" | "error"
): string {
  const target = new URL(`/app/${workspaceId}/connectors`, returnOrigin);
  target.searchParams.set("tab", "sources");
  if (status) {
    target.searchParams.set("source_oauth", status);
  }
  return target.toString();
}

export function buildDesktopSourceCallbackHtml(status: "success" | "error", sourceName?: string): string {
  const title = status === "success"
    ? `${sourceName ?? "Source"} connected`
    : `${sourceName ?? "Source"} connection failed`;
  const message = status === "success"
    ? `${sourceName ?? "The source"} is connected. Return to Meowbert Desktop and refresh the workspace.`
    : `${sourceName ?? "The source"} connection was cancelled or failed. Return to Meowbert Desktop and try again.`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0c1220;
        color: #f6f8ff;
      }
      .card {
        width: min(560px, calc(100vw - 2rem));
        padding: 2rem;
        border-radius: 20px;
        border: 1px solid rgba(116, 167, 255, 0.2);
        background: rgba(16, 24, 39, 0.94);
        box-shadow: 0 24px 60px rgba(2, 8, 20, 0.45);
      }
      h1 {
        margin: 0 0 0.8rem;
        font-size: 1.5rem;
      }
      p {
        margin: 0;
        color: #c7d2ea;
        line-height: 1.55;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}
