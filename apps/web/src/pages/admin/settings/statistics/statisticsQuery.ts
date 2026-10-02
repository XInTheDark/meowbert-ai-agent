import type { AdminStatisticsBucket, AdminStatisticsRange } from "../shared";

export function formatDateForInput(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toIsoQueryDate(value: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function buildStatisticsQueryPath(input: {
  range: AdminStatisticsRange;
  bucket: "auto" | AdminStatisticsBucket;
  from: string;
  to: string;
  selectedModels: string[];
  selectedUsers: string[];
  userSearch: string;
}): string {
  const params = new URLSearchParams({ range: input.range });
  if (input.range === "custom") {
    const from = toIsoQueryDate(input.from);
    const to = toIsoQueryDate(input.to);
    if (from) {
      params.set("from", from);
    }
    if (to) {
      params.set("to", to);
    }
  }
  if (input.bucket !== "auto") {
    params.set("bucket", input.bucket);
  }
  if (input.selectedModels.length > 0) {
    params.set("models", input.selectedModels.join(","));
  }
  if (input.selectedUsers.length > 0) {
    params.set("users", input.selectedUsers.join(","));
  }
  const userSearch = input.userSearch.trim();
  if (userSearch.length > 0) {
    params.set("userSearch", userSearch);
  }
  return `/api/admin/statistics/usage?${params.toString()}`;
}
