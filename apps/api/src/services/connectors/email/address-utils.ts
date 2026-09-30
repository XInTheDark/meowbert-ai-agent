const EMAIL_LOCAL_PART_REGEX = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeInboundDomain(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = normalizeWhitespace(value).toLowerCase();
  if (!trimmed) {
    return null;
  }

  const strippedPrefix = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const withoutTrailingDot = strippedPrefix.replace(/\.+$/, "");
  if (!withoutTrailingDot || withoutTrailingDot.includes("@") || withoutTrailingDot.includes("/")) {
    return null;
  }

  return withoutTrailingDot;
}

export function normalizeEmailAddress(rawValue: string | null | undefined): string | null {
  if (typeof rawValue !== "string") {
    return null;
  }

  const trimmed = normalizeWhitespace(rawValue);
  if (!trimmed) {
    return null;
  }

  const angleMatch = trimmed.match(/<([^>]+)>/);
  const candidate = (angleMatch?.[1] ?? trimmed).trim();
  const atIndex = candidate.indexOf("@");
  if (atIndex <= 0 || atIndex !== candidate.lastIndexOf("@") || atIndex === candidate.length - 1) {
    return null;
  }

  const localPart = candidate.slice(0, atIndex).trim().toLowerCase();
  const domain = normalizeInboundDomain(candidate.slice(atIndex + 1));
  if (!localPart || !domain) {
    return null;
  }

  return `${localPart}@${domain}`;
}

export function normalizeEmailLocalPart(rawValue: string | null | undefined): string | null {
  if (typeof rawValue !== "string") {
    return null;
  }

  const trimmed = normalizeWhitespace(rawValue).toLowerCase();
  if (!trimmed) {
    return null;
  }

  const localPart = trimmed.includes("@") ? trimmed.split("@", 1)[0] : trimmed;
  if (!localPart || localPart.length > 64 || !EMAIL_LOCAL_PART_REGEX.test(localPart)) {
    return null;
  }

  return localPart;
}

export function parseTrustedSenderList(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  const normalized = value
    .split(",")
    .map((entry) => normalizeEmailAddress(entry))
    .filter((entry): entry is string => typeof entry === "string");

  return Array.from(new Set(normalized));
}

export function parseTrustedSenderArray(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = values
    .map((entry) => normalizeEmailAddress(entry))
    .filter((entry): entry is string => typeof entry === "string");

  return Array.from(new Set(normalized));
}

export function splitNormalizedEmailAddress(email: string): { localPart: string; domain: string } | null {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) {
    return null;
  }

  const atIndex = normalized.indexOf("@");
  return {
    localPart: normalized.slice(0, atIndex),
    domain: normalized.slice(atIndex + 1)
  };
}
