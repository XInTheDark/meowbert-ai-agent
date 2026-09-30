import webpush from "web-push";
import { isAllowedWebPushEndpoint, type WebPushSubscriptionInput } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { config } from "../../lib/config.js";

interface VapidKeysRecord {
  publicKey: string;
  privateKey: string;
  contactEmail: string;
}

interface VapidKeysRow {
  web_push_vapid_public_key: string | null;
  web_push_vapid_private_key: string | null;
  web_push_contact_email: string | null;
}

let cachedVapidKeys: VapidKeysRecord | null = null;
let resolvingVapidKeys: Promise<VapidKeysRecord> | null = null;

export function resetCachedVapidKeysForTest(): void {
  cachedVapidKeys = null;
  resolvingVapidKeys = null;
}

function normalizeContactEmail(email: string | undefined): string {
  if (!email || email.trim().length === 0) {
    return "mailto:admin@meowbert.local";
  }
  return email.startsWith("mailto:") ? email : `mailto:${email}`;
}

function toVapidKeys(row: VapidKeysRow | null): VapidKeysRecord | null {
  if (!row?.web_push_vapid_public_key || !row.web_push_vapid_private_key) {
    return null;
  }

  return {
    publicKey: row.web_push_vapid_public_key,
    privateKey: row.web_push_vapid_private_key,
    contactEmail: normalizeContactEmail(row.web_push_contact_email ?? undefined)
  };
}

async function loadStoredVapidKeys(): Promise<VapidKeysRow | null> {
  const result = await query<VapidKeysRow>(
    `SELECT web_push_vapid_public_key, web_push_vapid_private_key, web_push_contact_email
       FROM platform_settings
      WHERE id = 1`
  );
  return result.rows[0] ?? null;
}

async function resolveVapidKeysUncached(): Promise<VapidKeysRecord> {
  const configVapid = config.webPush;
  const hasConfiguredPublicKey = Boolean(configVapid?.vapidPublicKey);
  const hasConfiguredPrivateKey = Boolean(configVapid?.vapidPrivateKey);
  if (hasConfiguredPublicKey !== hasConfiguredPrivateKey) {
    throw new Error("Web Push VAPID configuration must include both public and private keys");
  }

  if (hasConfiguredPublicKey && hasConfiguredPrivateKey) {
    return {
      publicKey: configVapid!.vapidPublicKey!,
      privateKey: configVapid!.vapidPrivateKey!,
      contactEmail: normalizeContactEmail(configVapid!.contactEmail)
    };
  }

  const row = await loadStoredVapidKeys();
  const storedKeys = toVapidKeys(row);
  if (storedKeys) {
    return storedKeys;
  }

  const generated = webpush.generateVAPIDKeys();
  const contactEmail = normalizeContactEmail(row?.web_push_contact_email ?? undefined);

  const updateResult = await query<VapidKeysRow>(
    `UPDATE platform_settings
        SET web_push_vapid_public_key = $1,
            web_push_vapid_private_key = $2,
            web_push_contact_email = COALESCE(web_push_contact_email, $3)
      WHERE id = 1
        AND (web_push_vapid_public_key IS NULL OR web_push_vapid_private_key IS NULL)
      RETURNING web_push_vapid_public_key, web_push_vapid_private_key, web_push_contact_email`,
    [generated.publicKey, generated.privateKey, contactEmail]
  );

  const resolvedKeys = toVapidKeys(updateResult.rows[0] ?? null) ?? toVapidKeys(await loadStoredVapidKeys());
  if (!resolvedKeys) {
    throw new Error("Unable to persist Web Push VAPID keys");
  }

  return resolvedKeys;
}

export async function resolveVapidKeys(): Promise<VapidKeysRecord> {
  if (cachedVapidKeys) {
    return cachedVapidKeys;
  }

  if (!resolvingVapidKeys) {
    resolvingVapidKeys = resolveVapidKeysUncached().then((resolvedKeys) => {
      cachedVapidKeys = resolvedKeys;
      return resolvedKeys;
    });
  }

  try {
    return await resolvingVapidKeys;
  } finally {
    resolvingVapidKeys = null;
  }
}

export async function getWebPushPublicKey(): Promise<{ publicKey: string; enabled: boolean }> {
  if (config.webPush?.enabled === false) {
    return { publicKey: "", enabled: false };
  }

  const keys = await resolveVapidKeys();
  return { publicKey: keys.publicKey, enabled: true };
}

export async function saveWebPushSubscription(
  userId: string,
  input: WebPushSubscriptionInput
): Promise<void> {
  if (!isAllowedWebPushEndpoint(input.endpoint)) {
    throw new Error("Unsupported Web Push endpoint");
  }

  await query(
    `INSERT INTO web_push_subscriptions (
       user_id, endpoint, p256dh, auth, user_agent, notify_on_background_responses, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (endpoint)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent,
       notify_on_background_responses = EXCLUDED.notify_on_background_responses,
       updated_at = now()`,
    [
      userId,
      input.endpoint,
      input.keys.p256dh,
      input.keys.auth,
      input.userAgent ?? null,
      input.notifyOnBackgroundResponses
    ]
  );
}

export async function removeWebPushSubscription(userId: string, endpoint: string): Promise<void> {
  await query(
    `DELETE FROM web_push_subscriptions
      WHERE user_id = $1
        AND endpoint = $2`,
    [userId, endpoint]
  );
}
