import { isWithinPath } from "../../packages/shared/src/path-containment.mjs";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for source tools.`);
  }
  return value;
}

function decodeFileName(value) {
  if (!value) {
    return null;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getSourceRuntimeContext() {
  return {
    baseUrl: requireEnv("SOURCE_PROXY_BASE_URL"),
    ticket: requireEnv("SOURCE_PROXY_TICKET"),
    sourceId: requireEnv("SOURCE_ID"),
    provider: requireEnv("SOURCE_PROVIDER"),
    taskDir: requireEnv("MEOWBERT_TASK_DIR"),
    workspaceRoot: requireEnv("MEOWBERT_WORKSPACE_ROOT")
  };
}

function buildSourceUrl(pathname, searchParams) {
  const context = getSourceRuntimeContext();
  const url = new URL(pathname, `${context.baseUrl}/`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === null || value === undefined || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return { context, url };
}

async function fetchSourceProxy(pathname, searchParams, options) {
  const { context, url } = buildSourceUrl(pathname, searchParams);
  const response = await fetch(url, {
    method: options?.method ?? "GET",
    headers: {
      authorization: `Bearer ${context.ticket}`,
      ...(options?.headers ?? {})
    },
    body: options?.body
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Source proxy request failed with HTTP ${response.status}.`);
  }

  return response;
}

async function requestSourceProxyJson(pathname, options) {
  const response = await fetchSourceProxy(pathname, options?.searchParams, {
    method: options?.method,
    headers: options?.body === undefined ? undefined : { "content-type": "application/json" },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return response.json();
}

export async function searchSourceFiles({ query, folderId, limit }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/search`, {
    searchParams: {
      q: query,
      ...(folderId ? { folderId } : {}),
      ...(typeof limit === "number" ? { limit } : {})
    }
  });
}

export async function browseSourceFolder({ folderId, limit }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/browse`, {
    searchParams: {
      ...(folderId ? { folderId } : {}),
      ...(typeof limit === "number" ? { limit } : {})
    }
  });
}

function resolveOutputPath(outputPath) {
  const context = getSourceRuntimeContext();
  const normalized = path.isAbsolute(outputPath)
    ? path.normalize(outputPath)
    : path.resolve(context.taskDir, outputPath);

  const allowedRoots = [context.taskDir, context.workspaceRoot].map((root) => path.resolve(root));
  if (!allowedRoots.some((root) => isWithinPath(root, normalized))) {
    throw new Error("output_path must stay within the task directory or workspace root.");
  }

  return normalized;
}

export async function downloadSourceFileToPath({ itemId, outputPath }) {
  const context = getSourceRuntimeContext();
  const response = await fetchSourceProxy(`/api/internal/sources/${context.sourceId}/file`, {
    itemId
  });
  if (!response.body) {
    throw new Error("Source download returned an empty body.");
  }

  const resolvedOutputPath = resolveOutputPath(outputPath);
  await fsPromises.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(resolvedOutputPath)
  );

  const stats = await fsPromises.stat(resolvedOutputPath);
  const fileName = decodeFileName(response.headers.get("x-source-file-name")) ?? path.basename(resolvedOutputPath);
  const mimeType = response.headers.get("content-type");

  return {
    saved_to: resolvedOutputPath,
    file_name: fileName,
    size_bytes: stats.size,
    mime_type: mimeType
  };
}

export async function searchOutlookEmails({ query, limit }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/outlook/messages/search`, {
    searchParams: {
      q: query,
      ...(typeof limit === "number" ? { limit } : {})
    }
  });
}

export async function readOutlookEmail({ messageId, bodyFormat }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/outlook/messages/item`, {
    searchParams: {
      messageId,
      ...(bodyFormat ? { bodyFormat } : {})
    }
  });
}

export async function listOutlookCalendars({ limit }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/outlook/calendars`, {
    searchParams: {
      ...(typeof limit === "number" ? { limit } : {})
    }
  });
}

export async function searchOutlookCalendarEvents({ query, calendarId, limit }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/outlook/calendars/search`, {
    searchParams: {
      q: query,
      ...(calendarId ? { calendarId } : {}),
      ...(typeof limit === "number" ? { limit } : {})
    }
  });
}

export async function viewOutlookCalendar({ calendarId, startDateTime, endDateTime, timezone, limit }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/outlook/calendars/view`, {
    searchParams: {
      ...(calendarId ? { calendarId } : {}),
      startDateTime,
      endDateTime,
      ...(timezone ? { timezone } : {}),
      ...(typeof limit === "number" ? { limit } : {})
    }
  });
}

export async function readOutlookCalendarEvent({ eventId, calendarId, timezone, bodyFormat }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/outlook/events/item`, {
    searchParams: {
      eventId,
      ...(calendarId ? { calendarId } : {}),
      ...(timezone ? { timezone } : {}),
      ...(bodyFormat ? { bodyFormat } : {})
    }
  });
}

export async function createOutlookCalendarEvent({ timezone, bodyFormat, event }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/outlook/events`, {
    method: "POST",
    body: {
      ...(timezone ? { timezone } : {}),
      ...(bodyFormat ? { bodyFormat } : {}),
      event
    }
  });
}

export async function updateOutlookCalendarEvent({ eventId, timezone, bodyFormat, event }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/outlook/events/item`, {
    method: "PATCH",
    searchParams: {
      eventId
    },
    body: {
      ...(timezone ? { timezone } : {}),
      ...(bodyFormat ? { bodyFormat } : {}),
      event
    }
  });
}

export async function deleteOutlookCalendarEvent({ eventId, calendarId, expectedChangeKey, confirmAttendeeCancellation }) {
  const context = getSourceRuntimeContext();
  return requestSourceProxyJson(`/api/internal/sources/${context.sourceId}/outlook/events/item`, {
    method: "DELETE",
    searchParams: {
      eventId,
      ...(calendarId ? { calendarId } : {}),
      expectedChangeKey,
      ...(typeof confirmAttendeeCancellation === "boolean" ? { confirmAttendeeCancellation } : {})
    }
  });
}
