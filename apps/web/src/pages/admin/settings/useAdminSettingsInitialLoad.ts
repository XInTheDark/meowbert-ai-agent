import { useEffect } from "react";
import type { ApiClient } from "../../../lib/api";
import type {
  AdminRuntimeMigrationsResponse,
  AdminSettingsResponse,
  AdminStorageResponse,
  EmailInboundDebugEventsResponse,
  NewsletterCampaignsResponse,
  SharedConnectorStatusResponse,
  SubscriptionPlansResponse,
  AnnouncementSummary
} from "./shared";
import type { useAdminConnectorSettings } from "./useAdminConnectorSettings";
import type { useAdminPlatformSettings } from "./useAdminPlatformSettings";
import type { useAdminPublishingSettings } from "./useAdminPublishingSettings";
import type { useAdminRuntimeMigrations } from "./useAdminRuntimeMigrations";
import type { useAdminStorageSettings } from "./useAdminStorageSettings";

interface UseAdminSettingsInitialLoadInput {
  api: ApiClient;
  isSuperAdmin: boolean;
  setError: (error: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  platform: ReturnType<typeof useAdminPlatformSettings>;
  storage: ReturnType<typeof useAdminStorageSettings>;
  connectors: ReturnType<typeof useAdminConnectorSettings>;
  publishing: ReturnType<typeof useAdminPublishingSettings>;
  migrations: ReturnType<typeof useAdminRuntimeMigrations>;
}

export function useAdminSettingsInitialLoad(input: UseAdminSettingsInitialLoadInput): void {
  useEffect(() => {
    if (!input.isSuperAdmin) {
      input.setIsLoading(false);
      return;
    }

    let cancelled = false;
    input.setIsLoading(true);
    input.setError(null);
    Promise.all([
      input.api.get<AdminSettingsResponse>("/api/admin/settings"),
      input.storage.loadStorageOverview(),
      input.api.get<AdminRuntimeMigrationsResponse>("/api/admin/migrations"),
      input.api.get<SharedConnectorStatusResponse>("/api/admin/connectors/shared"),
      input.api.get<SubscriptionPlansResponse>("/api/admin/subscriptions/plans"),
      input.api.get<NewsletterCampaignsResponse>("/api/admin/newsletters"),
      input.api.get<EmailInboundDebugEventsResponse>("/api/admin/connectors/shared/email-inbound/debug-events?limit=200"),
      input.api.get<{ announcements: AnnouncementSummary[] }>("/api/announcements")
    ]).then(([settings, storage, migrations, connectors, plans, campaigns, debugEvents, announcements]) => {
      if (cancelled) return;
      input.platform.applyPlatformSettings(settings.settings);
      input.storage.applyStorageOverview(storage);
      input.storage.setMigrateExistingOnDefaultChange(false);
      input.migrations.setAdminRuntimeMigrations(migrations.migrations);
      input.connectors.applyConnectorSnapshot(connectors.connectors, debugEvents.events);
      input.publishing.applyPublishingSnapshot({
        plans: plans.plans,
        campaigns: campaigns.campaigns,
        announcements: announcements.announcements
      });
    }).catch((error) => {
      if (!cancelled) input.setError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) input.setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [input.api, input.isSuperAdmin]);
}
