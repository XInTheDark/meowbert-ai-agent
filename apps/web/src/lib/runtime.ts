const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

interface RuntimeState {
  apiBaseUrl: string;
}

let runtimeState: RuntimeState = {
  apiBaseUrl: DEFAULT_API_BASE_URL
};

export function defaultApiBaseUrl(): string {
  return DEFAULT_API_BASE_URL;
}

export function setRuntimeApiBaseUrl(nextApiBaseUrl: string | null | undefined): void {
  const trimmed = nextApiBaseUrl?.trim();
  runtimeState = {
    ...runtimeState,
    apiBaseUrl: trimmed && trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : DEFAULT_API_BASE_URL
  };
}

export function apiBaseUrl(): string {
  return runtimeState.apiBaseUrl;
}

export function taskEventsUrl(taskId: string): string {
  return `${apiBaseUrl()}/api/tasks/${taskId}/events/stream`;
}

export function desktopComputerStreamUrl(): string {
  return `${apiBaseUrl()}/api/desktop/computer/stream`;
}
