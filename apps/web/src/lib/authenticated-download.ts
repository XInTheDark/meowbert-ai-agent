interface DownloadErrorPayload {
  error?: string;
}

async function readDownloadError(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null) as DownloadErrorPayload | null;
    if (payload?.error) {
      return payload.error;
    }
  }

  const text = await response.text().catch(() => "");
  return text || `Download failed with HTTP ${response.status}`;
}

export async function triggerAuthenticatedBrowserDownload(input: {
  url: string;
  token: string | null;
  suggestedFilename: string;
}): Promise<void> {
  if (!input.token) {
    throw new Error("Unauthorized");
  }

  const response = await fetch(input.url, {
    headers: {
      authorization: `Bearer ${input.token}`
    }
  });

  if (!response.ok) {
    throw new Error(await readDownloadError(response));
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = input.suggestedFilename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 0);
}
