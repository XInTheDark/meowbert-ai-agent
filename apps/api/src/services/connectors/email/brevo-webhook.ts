const BREVO_WEBHOOKS_API_BASE_URL = "https://api.brevo.com/v3/webhooks";
const BREVO_INBOUND_EVENT = "inboundEmailProcessed";
const BREVO_INBOUND_DESCRIPTION = "Meowbert inbound email webhook";
const BREVO_REQUEST_TIMEOUT_MS = 15_000;

export interface BrevoWebhookSummary {
  id: number;
  type: string;
  url: string;
  domain: string | null;
  events: string[];
  description: string | null;
}

export interface EnsureBrevoInboundWebhookResult {
  action: "created" | "updated" | "existing";
  webhook: BrevoWebhookSummary;
}

class BrevoWebhookApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly method: "GET" | "POST" | "PUT";
  readonly pathSuffix: string;

  constructor(input: {
    message: string;
    status: number;
    code: string | null;
    method: "GET" | "POST" | "PUT";
    pathSuffix: string;
  }) {
    super(input.message);
    this.name = "BrevoWebhookApiError";
    this.status = input.status;
    this.code = input.code;
    this.method = input.method;
    this.pathSuffix = input.pathSuffix;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRequiredText(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  return normalized && normalized.length > 0 ? normalized : null;
}

function parseWebhookId(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function mapWebhookSummary(value: unknown): BrevoWebhookSummary | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const id = parseWebhookId(record.id);
  const type = normalizeRequiredText(record.type);
  const url = normalizeRequiredText(record.url);
  if (!id || !type || !url) {
    return null;
  }

  const events = Array.isArray(record.events)
    ? record.events.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    id,
    type,
    url,
    domain: normalizeOptionalText(record.domain),
    events,
    description: normalizeOptionalText(record.description)
  };
}

function parseErrorMessage(payload: unknown, status: number): string {
  const record = asRecord(payload);
  const message = normalizeOptionalText(record?.message);
  if (message) {
    return message;
  }

  return `Brevo webhook API request failed with HTTP ${status}`;
}

function parseErrorCode(payload: unknown): string | null {
  const record = asRecord(payload);
  return normalizeOptionalText(record?.code);
}

function formatBrevoApiError(error: BrevoWebhookApiError): string {
  const codeLabel = error.code ? `, code=${error.code}` : "";
  return `${error.message} (method=${error.method}, path=${error.pathSuffix}, status=${error.status}${codeLabel})`;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof BrevoWebhookApiError) {
    return formatBrevoApiError(error);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sanitizeWebhookUrlForError(webhookUrl: string): string {
  try {
    const url = new URL(webhookUrl);
    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "<redacted>");
    }
    return url.toString();
  } catch {
    return "(invalid URL)";
  }
}

function buildSyncErrorMessage(input: {
  phase: string;
  error: unknown;
  trace: string[];
}): string {
  const traceText = input.trace.length > 0 ? input.trace.join(" | ") : "none";
  return `${input.phase}: ${formatUnknownError(input.error)} | trace=${traceText}`;
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  const raw = await response.text();
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return {};
  }
}

async function brevoWebhookRequest(input: {
  apiKey: string;
  method: "GET" | "POST" | "PUT";
  pathSuffix: string;
  body?: Record<string, unknown>;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BREVO_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${BREVO_WEBHOOKS_API_BASE_URL}${input.pathSuffix}`, {
      method: input.method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": input.apiKey
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: controller.signal
    });

    const payload = await parseResponsePayload(response);
    if (!response.ok) {
      throw new BrevoWebhookApiError({
        message: parseErrorMessage(payload, response.status),
        status: response.status,
        code: parseErrorCode(payload),
        method: input.method,
        pathSuffix: input.pathSuffix
      });
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function listBrevoInboundWebhooks(apiKey: string): Promise<BrevoWebhookSummary[]> {
  let payload: unknown;
  try {
    payload = await brevoWebhookRequest({
      apiKey,
      method: "GET",
      pathSuffix: "?type=inbound"
    });
  } catch (error) {
    // Brevo may return document_not_found when there are no inbound webhooks yet.
    if (isInboundWebhookListMissingError(error)) {
      return [];
    }
    throw error;
  }

  const record = asRecord(payload);
  const webhooks = Array.isArray(record?.webhooks) ? record.webhooks : [];

  return webhooks
    .map((entry) => mapWebhookSummary(entry))
    .filter((entry): entry is BrevoWebhookSummary => entry !== null);
}

function isInboundWebhookListMissingError(error: unknown): boolean {
  if (!(error instanceof BrevoWebhookApiError)) {
    return false;
  }

  if (error.method !== "GET") {
    return false;
  }

  if (error.pathSuffix !== "?type=inbound") {
    return false;
  }

  if (error.status !== 400) {
    return false;
  }

  const normalizedCode = error.code?.toLowerCase();
  if (normalizedCode === "document_not_found" || normalizedCode === "not_found") {
    return true;
  }

  const normalizedMessage = error.message.toLowerCase();
  return normalizedMessage.includes("does not exist") || normalizedMessage.includes("not found");
}

function hasInboundEvent(webhook: BrevoWebhookSummary): boolean {
  return webhook.events.includes(BREVO_INBOUND_EVENT);
}

function isLikelyManagedByMeowbert(webhook: BrevoWebhookSummary): boolean {
  return webhook.description === BREVO_INBOUND_DESCRIPTION
    || webhook.url.includes("/api/connectors/email/inbound/brevo");
}

function buildDesiredPayload(input: { webhookUrl: string; inboundDomain: string }): Record<string, unknown> {
  return {
    type: "inbound",
    events: [BREVO_INBOUND_EVENT],
    url: input.webhookUrl,
    domain: input.inboundDomain,
    description: BREVO_INBOUND_DESCRIPTION
  };
}

function buildDesiredWebhookSummary(input: {
  id: number;
  webhookUrl: string;
  inboundDomain: string;
}): BrevoWebhookSummary {
  return {
    id: input.id,
    type: "inbound",
    url: input.webhookUrl,
    domain: input.inboundDomain,
    events: [BREVO_INBOUND_EVENT],
    description: BREVO_INBOUND_DESCRIPTION
  };
}

function parseCreatedWebhookId(payload: unknown): number | null {
  const record = asRecord(payload);
  const responseId = parseWebhookId(record?.id);
  if (responseId) {
    return responseId;
  }

  const summary = mapWebhookSummary(payload);
  return summary?.id ?? null;
}

async function createBrevoWebhook(input: {
  apiKey: string;
  payload: Record<string, unknown>;
}): Promise<number> {
  const createdPayload = await brevoWebhookRequest({
    apiKey: input.apiKey,
    method: "POST",
    pathSuffix: "",
    body: input.payload
  });

  const createdId = parseCreatedWebhookId(createdPayload);
  if (!createdId) {
    throw new Error("Brevo webhook creation succeeded but returned an unexpected payload.");
  }

  return createdId;
}

async function updateBrevoWebhook(input: {
  apiKey: string;
  webhookId: number;
  payload: Record<string, unknown>;
}): Promise<void> {
  await brevoWebhookRequest({
    apiKey: input.apiKey,
    method: "PUT",
    pathSuffix: `/${input.webhookId}`,
    body: input.payload
  });
}

function isWebhookMissingError(error: unknown): boolean {
  if (!(error instanceof BrevoWebhookApiError)) {
    return false;
  }

  if (error.status === 404) {
    return true;
  }

  const normalizedCode = error.code?.toLowerCase();
  if (normalizedCode === "not_found" || normalizedCode === "document_not_found") {
    return true;
  }

  const normalizedMessage = error.message.toLowerCase();
  return normalizedMessage.includes("does not exist") || normalizedMessage.includes("not found");
}

export function buildBrevoInboundWebhookUrl(input: {
  apiBaseUrl: string;
  webhookSecret: string;
}): string {
  const normalizedBaseUrl = input.apiBaseUrl.trim().replace(/\/+$/, "");
  const normalizedSecret = input.webhookSecret.trim();
  if (!normalizedBaseUrl) {
    throw new Error("API base URL is required to build Brevo inbound webhook URL.");
  }
  if (!normalizedSecret) {
    throw new Error("Webhook secret is required to build Brevo inbound webhook URL.");
  }

  const url = new URL("/api/connectors/email/inbound/brevo", `${normalizedBaseUrl}/`);
  url.searchParams.set("token", normalizedSecret);
  return url.toString();
}

export async function ensureBrevoInboundWebhook(input: {
  apiKey: string;
  inboundDomain: string;
  webhookUrl: string;
}): Promise<EnsureBrevoInboundWebhookResult> {
  const trace: string[] = [
    `domain=${input.inboundDomain}`,
    `webhook=${sanitizeWebhookUrlForError(input.webhookUrl)}`
  ];
  const desiredPayload = buildDesiredPayload({
    webhookUrl: input.webhookUrl,
    inboundDomain: input.inboundDomain
  });
  async function listAndFindExactMatch(): Promise<{
    exactMatch: BrevoWebhookSummary | null;
    managedWebhooks: BrevoWebhookSummary[];
  }> {
    const webhooks = await listBrevoInboundWebhooks(input.apiKey);
    const exactMatch = webhooks.find((webhook) =>
      webhook.type === "inbound"
      && webhook.url === input.webhookUrl
      && webhook.domain === input.inboundDomain
      && hasInboundEvent(webhook)
    ) ?? null;
    const managedWebhooks = webhooks.filter((webhook) =>
      webhook.type === "inbound"
      && webhook.domain === input.inboundDomain
      && isLikelyManagedByMeowbert(webhook)
    );

    trace.push(
      `list exact=${exactMatch ? exactMatch.id : "none"} managed=${managedWebhooks.length > 0 ? managedWebhooks.map((entry) => entry.id).join(",") : "none"}`
    );

    return { exactMatch, managedWebhooks };
  }

  async function tryUpdateManagedWebhooks(inputForUpdate: {
    passLabel: "pass1" | "pass2";
    managedWebhooks: BrevoWebhookSummary[];
  }): Promise<EnsureBrevoInboundWebhookResult | null> {
    const { managedWebhooks, passLabel } = inputForUpdate;
    for (const managedWebhook of managedWebhooks) {
      try {
        await updateBrevoWebhook({
          apiKey: input.apiKey,
          webhookId: managedWebhook.id,
          payload: desiredPayload
        });
        trace.push(`${passLabel}:update id=${managedWebhook.id} -> updated`);

        return {
          action: "updated",
          webhook: buildDesiredWebhookSummary({
            id: managedWebhook.id,
            webhookUrl: input.webhookUrl,
            inboundDomain: input.inboundDomain
          })
        };
      } catch (error) {
        if (!isWebhookMissingError(error)) {
          throw new Error(
            buildSyncErrorMessage({
              phase: `${passLabel}: update failed for webhook #${managedWebhook.id}`,
              error,
              trace
            })
          );
        }
        trace.push(`${passLabel}:update id=${managedWebhook.id} -> missing (${formatUnknownError(error)})`);
      }
    }

    return null;
  }

  async function createDesiredWebhook(passLabel: "pass1" | "pass2"): Promise<EnsureBrevoInboundWebhookResult> {
    try {
      const createdWebhookId = await createBrevoWebhook({
        apiKey: input.apiKey,
        payload: desiredPayload
      });
      trace.push(`${passLabel}:create id=${createdWebhookId} -> created`);

      return {
        action: "created",
        webhook: buildDesiredWebhookSummary({
          id: createdWebhookId,
          webhookUrl: input.webhookUrl,
          inboundDomain: input.inboundDomain
        })
      };
    } catch (error) {
      trace.push(`${passLabel}:create -> failed (${formatUnknownError(error)})`);
      throw error;
    }
  }

  let firstPass: { exactMatch: BrevoWebhookSummary | null; managedWebhooks: BrevoWebhookSummary[] };
  try {
    firstPass = await listAndFindExactMatch();
  } catch (error) {
    throw new Error(
      buildSyncErrorMessage({
        phase: "pass1: list inbound webhooks failed",
        error,
        trace
      })
    );
  }

  if (firstPass.exactMatch) {
    trace.push(`pass1:exact match id=${firstPass.exactMatch.id}`);
    return {
      action: "existing",
      webhook: firstPass.exactMatch
    };
  }

  const updatedFromFirstPass = await tryUpdateManagedWebhooks({
    passLabel: "pass1",
    managedWebhooks: firstPass.managedWebhooks
  });
  if (updatedFromFirstPass) {
    return updatedFromFirstPass;
  }

  try {
    return await createDesiredWebhook("pass1");
  } catch (error) {
    if (!isWebhookMissingError(error)) {
      throw new Error(
        buildSyncErrorMessage({
          phase: "pass1: create webhook failed",
          error,
          trace
        })
      );
    }
  }

  // Brevo may surface transient stale-record errors for webhook writes.
  // Refresh state and retry once before giving up.
  trace.push("pass1:create missing-record error -> retrying with refreshed list");

  let secondPass: { exactMatch: BrevoWebhookSummary | null; managedWebhooks: BrevoWebhookSummary[] };
  try {
    secondPass = await listAndFindExactMatch();
  } catch (error) {
    throw new Error(
      buildSyncErrorMessage({
        phase: "pass2: list inbound webhooks failed",
        error,
        trace
      })
    );
  }
  if (secondPass.exactMatch) {
    trace.push(`pass2:exact match id=${secondPass.exactMatch.id}`);
    return {
      action: "existing",
      webhook: secondPass.exactMatch
    };
  }

  const updatedFromSecondPass = await tryUpdateManagedWebhooks({
    passLabel: "pass2",
    managedWebhooks: secondPass.managedWebhooks
  });
  if (updatedFromSecondPass) {
    return updatedFromSecondPass;
  }

  try {
    return await createDesiredWebhook("pass2");
  } catch (error) {
    throw new Error(
      buildSyncErrorMessage({
        phase: "pass2: create webhook failed",
        error,
        trace
      })
    );
  }
}
