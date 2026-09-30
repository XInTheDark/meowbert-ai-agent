import { useEffect, useState } from "react";
import type { InlineFilePreviewKind } from "./filePreviewKinds";

type AuthenticatedFilePreviewState =
  | { status: "idle"; objectUrl: null; error: null }
  | { status: "loading"; objectUrl: null; error: null }
  | { status: "ready"; objectUrl: string; error: null }
  | { status: "error"; objectUrl: null; error: string };

interface UseAuthenticatedFilePreviewInput {
  kind: InlineFilePreviewKind | null;
  sourceUrl: string | null;
  token: string | null;
  mimeType?: string | null;
}

async function readPreviewError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (payload?.error) {
      return payload.error;
    }
  }

  const text = await response.text().catch(() => "");
  return text || `Preview failed with HTTP ${response.status}`;
}

export function useAuthenticatedFilePreview(
  input: UseAuthenticatedFilePreviewInput
): AuthenticatedFilePreviewState {
  const [state, setState] = useState<AuthenticatedFilePreviewState>({
    status: "idle",
    objectUrl: null,
    error: null
  });

  useEffect(() => {
    if (!input.kind || !input.sourceUrl || !input.token) {
      setState({ status: "idle", objectUrl: null, error: null });
      return;
    }

    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;

    setState({ status: "loading", objectUrl: null, error: null });

    void fetch(input.sourceUrl, {
      headers: {
        authorization: `Bearer ${input.token}`
      },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readPreviewError(response));
        }

        const blob = await response.blob();
        const previewBlob = input.mimeType && blob.type !== input.mimeType
          ? new Blob([blob], { type: input.mimeType })
          : blob;
        objectUrl = window.URL.createObjectURL(previewBlob);
        if (active) {
          setState({ status: "ready", objectUrl, error: null });
          return;
        }

        window.URL.revokeObjectURL(objectUrl);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !active) {
          return;
        }

        setState({
          status: "error",
          objectUrl: null,
          error: error instanceof Error ? error.message : "Preview unavailable"
        });
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [input.kind, input.mimeType, input.sourceUrl, input.token]);

  return state;
}
