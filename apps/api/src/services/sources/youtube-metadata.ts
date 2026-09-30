import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const YT_DLP_TIMEOUT_MS = 20_000;
const YT_DLP_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const DESCRIPTION_PREVIEW_MAX_CHARS = 240;

interface YoutubeVideoMetadata {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  upload_date?: string;
  webpage_url?: string;
  original_url?: string;
  description?: string;
  view_count?: number;
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function formatUploadDate(value: string | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) {
    return null;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(4, 6), 10);
  const day = Number.parseInt(value.slice(6, 8), 10);
  const timestamp = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(timestamp));
}

function formatCount(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return new Intl.NumberFormat("en-US").format(value);
}

function buildDescriptionPreview(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= DESCRIPTION_PREVIEW_MAX_CHARS) {
    return normalized;
  }

  return `${normalized.slice(0, DESCRIPTION_PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
}

function buildMetadataSummary(input: YoutubeVideoMetadata, fallbackUrl: string): string {
  const parts = [
    `URL: ${input.webpage_url ?? input.original_url ?? fallbackUrl}`,
    input.title ? `Title: ${input.title}` : null,
    input.channel ?? input.uploader ? `Channel: ${input.channel ?? input.uploader}` : null,
    formatDuration(input.duration) ? `Duration: ${formatDuration(input.duration)}` : null,
    formatUploadDate(input.upload_date) ? `Published: ${formatUploadDate(input.upload_date)}` : null,
    formatCount(input.view_count) ? `Views: ${formatCount(input.view_count)}` : null,
    buildDescriptionPreview(input.description) ? `Description: ${buildDescriptionPreview(input.description)}` : null
  ].filter((part): part is string => Boolean(part));

  return `YouTube video metadata — ${parts.join("; ")}`;
}

function summarizeYtDlpFailure(error: unknown): never {
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") {
    throw new Error("yt-dlp is not installed on the API server.");
  }

  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = typeof (error as { stderr?: unknown }).stderr === "string"
      ? (error as { stderr: string }).stderr.trim()
      : "";
    if (stderr) {
      throw new Error(`Failed to read YouTube metadata: ${stderr}`);
    }
  }

  throw new Error(error instanceof Error ? error.message : "Failed to read YouTube metadata.");
}

export async function createYoutubeMetadataNoteAttachment(input: {
  url: string;
}): Promise<{
  label: string;
  content: string;
}> {
  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      ["--dump-single-json", "--no-warnings", "--skip-download", "--", input.url],
      {
        timeout: YT_DLP_TIMEOUT_MS,
        maxBuffer: YT_DLP_MAX_BUFFER_BYTES
      }
    );
    const payload = JSON.parse(stdout) as YoutubeVideoMetadata;
    const label = payload.title?.trim() || "YouTube video";
    return {
      label,
      content: buildMetadataSummary(payload, input.url)
    };
  } catch (error) {
    summarizeYtDlpFailure(error);
  }
}
