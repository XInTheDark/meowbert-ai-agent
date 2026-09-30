export interface ListmonkClientConfig {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs?: number;
}

export interface ListmonkTemplate {
  id: number;
  name: string;
  type: string;
  subject: string;
  body: string;
}

export interface UpsertListmonkTemplateInput {
  name: string;
  type: "tx";
  subject: string;
  body: string;
}

export type ListmonkMessageHeaders = Array<Record<string, string>>;

interface ListmonkEnvelope {
  data?: unknown;
  message?: string;
}

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return `Listmonk API request failed with HTTP ${status}`;
}

function toList<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }

  if (data && typeof data === "object") {
    const maybeResults = (data as { results?: unknown }).results;
    if (Array.isArray(maybeResults)) {
      return maybeResults as T[];
    }
  }

  return [];
}

export class ListmonkClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;

  constructor(config: ListmonkClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  private async request<T>(path: string, options: {
    method?: "GET" | "POST" | "PUT";
    body?: unknown;
    timeoutMs?: number;
  } = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          authorization: this.authHeader,
          "content-type": "application/json"
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });

      const payload = (await response.json().catch(() => ({}))) as ListmonkEnvelope;
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, response.status));
      }

      return payload.data as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Listmonk API request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async listTemplates(): Promise<ListmonkTemplate[]> {
    const data = await this.request<unknown>("/api/templates");
    return toList<ListmonkTemplate>(data);
  }

  async createTemplate(input: UpsertListmonkTemplateInput): Promise<ListmonkTemplate> {
    return this.request<ListmonkTemplate>("/api/templates", {
      method: "POST",
      body: input
    });
  }

  async updateTemplate(templateId: number, input: UpsertListmonkTemplateInput): Promise<ListmonkTemplate> {
    return this.request<ListmonkTemplate>(`/api/templates/${templateId}`, {
      method: "PUT",
      body: input
    });
  }

  async sendTransactionalEmail(input: {
    templateId: number;
    subscriberMode: "external";
    subscriberEmails: string[];
    data?: Record<string, unknown>;
    headers?: ListmonkMessageHeaders;
    subject?: string;
    contentType?: "html" | "plain" | "markdown";
  }): Promise<unknown> {
    return this.request<unknown>("/api/tx", {
      method: "POST",
      body: {
        template_id: input.templateId,
        subscriber_mode: input.subscriberMode,
        subscriber_emails: input.subscriberEmails,
        data: input.data,
        headers: input.headers,
        subject: input.subject,
        content_type: input.contentType
      },
      timeoutMs: 30_000
    });
  }
}
