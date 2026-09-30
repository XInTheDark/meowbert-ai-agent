import { assertSourceProviderRuntimeEnabled } from "@meowbert/shared";
import { googleDriveProviderClient } from "./providers/google-drive.js";
import { onedriveProviderClient } from "./providers/onedrive.js";
import { outlookProviderClient } from "./providers/outlook.js";
import { pcloudProviderClient } from "./providers/pcloud.js";
import { rcloneProviderClient } from "./providers/rclone.js";
import type { SourceOutlookProviderClient } from "./source-outlook-types.js";
import type { SourceFileProviderClient, SourceProvider, SourceProviderBaseClient } from "./source-types.js";

const sourceProviderClients: Partial<Record<SourceProvider, SourceProviderBaseClient>> = {
  "google-drive": googleDriveProviderClient,
  onedrive: onedriveProviderClient,
  outlook: outlookProviderClient,
  pcloud: pcloudProviderClient,
  rclone: rcloneProviderClient
};

const sourceFileProviderClients: Partial<Record<SourceProvider, SourceFileProviderClient>> = {
  "google-drive": googleDriveProviderClient,
  onedrive: onedriveProviderClient,
  pcloud: pcloudProviderClient,
  rclone: rcloneProviderClient
};

export function getSourceProviderClient(provider: SourceProvider): SourceProviderBaseClient {
  assertSourceProviderRuntimeEnabled(provider);
  const client = sourceProviderClients[provider];
  if (!client) {
    throw new Error(`Source provider ${provider} does not expose OAuth-backed source operations.`);
  }
  return client;
}

export function getSourceFileProviderClient(provider: SourceProvider): SourceFileProviderClient {
  assertSourceProviderRuntimeEnabled(provider);
  const client = sourceFileProviderClients[provider];
  if (!client) {
    throw new Error(`Source provider ${provider} does not expose API-backed file operations.`);
  }
  return client;
}

export function getSourceOutlookProviderClient(provider: SourceProvider): SourceOutlookProviderClient {
  if (provider !== "outlook") {
    throw new Error(`Source provider ${provider} does not expose Outlook mail/calendar operations.`);
  }

  return outlookProviderClient;
}
