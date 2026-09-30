import { UsersTab } from "../../../components/admin/UsersTab";
import { AnnouncementsTab } from "./AnnouncementsTab";
import { AiProvidersTab } from "./AiProvidersTab";
import { UtilitiesTab } from "./UtilitiesTab";
import { ConnectorSettingsTab } from "./ConnectorSettingsTab";
import { HostStorageSettingsTab } from "./HostStorageSettingsTab";
import { MigrationsSettingsTab } from "./MigrationsSettingsTab";
import { ModelSettingsTab } from "./ModelSettingsTab";
import { NewsletterTab } from "./NewsletterTab";
import { PlatformSettingsTab } from "./PlatformSettingsTab";
import { ProcessesTab } from "./ProcessesTab";
import { SourcesSettingsTab } from "./SourcesSettingsTab";
import { StatisticsSettingsTab } from "./StatisticsSettingsTab";
import { StorageSettingsTab } from "./StorageSettingsTab";
import { SubscriptionPlansTab } from "./SubscriptionPlansTab";
import type { AdminSettingsTabKey } from "./shared";
import type { useAdminConnectorSettings } from "./useAdminConnectorSettings";
import type { useAdminHostStorageSettings } from "./useAdminHostStorageSettings";
import type { useAdminPlatformSettings } from "./useAdminPlatformSettings";
import type { useAdminPublishingSettings } from "./useAdminPublishingSettings";
import type { useAdminRuntimeMigrations } from "./useAdminRuntimeMigrations";
import type { useAdminStorageSettings } from "./useAdminStorageSettings";

interface AdminSettingsTabContentProps {
  activeTab: AdminSettingsTabKey;
  error: string | null;
  isSaving: boolean;
  platform: ReturnType<typeof useAdminPlatformSettings>;
  hostStorage: ReturnType<typeof useAdminHostStorageSettings>;
  storage: ReturnType<typeof useAdminStorageSettings>;
  connectors: ReturnType<typeof useAdminConnectorSettings>;
  publishing: ReturnType<typeof useAdminPublishingSettings>;
  migrations: ReturnType<typeof useAdminRuntimeMigrations>;
}

function AdminStorageAndMigrationContent(props: AdminSettingsTabContentProps) {
  const { activeTab, error, isSaving, storage, hostStorage, migrations } = props;
  if (activeTab === "migrations") {
    return (
      <MigrationsSettingsTab
        migrations={migrations.adminRuntimeMigrations}
        isRunningMigrationKey={migrations.runningAdminMigrationKey}
        isSaving={isSaving || storage.isStorageSaving}
        onRunMigration={migrations.runAdminRuntimeMigration}
      />
    );
  }
  if (activeTab === "host-storage") {
    return (
      <HostStorageSettingsTab
        overview={hostStorage.overview}
        warmRetentionDaysDraft={hostStorage.warmRetentionDaysDraft}
        isLoading={hostStorage.isLoading}
        isSavingRetention={hostStorage.isSavingRetention}
        isPruningEvents={hostStorage.isPruningEvents}
        isVacuumingEvents={hostStorage.isVacuumingEvents}
        isQueueingArchive={hostStorage.isQueueingArchive}
        error={error}
        onWarmRetentionDaysDraftChange={hostStorage.setWarmRetentionDaysDraft}
        onRefresh={hostStorage.refreshOverview}
        onSaveWarmRetentionDays={hostStorage.saveWarmRetentionDays}
        onPruneEventsNow={hostStorage.pruneEventsNow}
        onVacuumFullTaskEvents={hostStorage.vacuumFullTaskEvents}
        onArchiveNextEligibleTask={hostStorage.archiveNextEligibleTask}
      />
    );
  }
  if (activeTab !== "storage") {
    return null;
  }

  return (
    <StorageSettingsTab
      storage={storage.storageOverview}
      defaultBackendIdDraft={storage.defaultStorageBackendDraft}
      migrateExistingOnDefaultChange={storage.migrateExistingOnDefaultChange}
      workspaceBackendDrafts={storage.workspaceBackendDrafts}
      storageUserSearchDraft={storage.storageUserSearchDraft}
      storageUserSearchResults={storage.storageUserSearchResults}
      selectedStorageUser={storage.selectedStorageUser}
      hasSearchedStorageUsers={storage.hasSearchedStorageUsers}
      isSaving={storage.isStorageSaving}
      testingStorageBackendId={storage.testingStorageBackendId}
      isSearchingStorageUsers={storage.isSearchingStorageUsers}
      isLoadingSelectedStorageUserWorkspaces={storage.isLoadingSelectedStorageUserWorkspaces}
      error={error}
      onDefaultBackendIdChange={storage.setDefaultStorageBackendDraft}
      onMigrateExistingOnDefaultChange={storage.setMigrateExistingOnDefaultChange}
      onWorkspaceBackendDraftChange={(workspaceId, backendId) => {
        storage.setWorkspaceBackendDrafts((previous) => ({ ...previous, [workspaceId]: backendId }));
      }}
      onStorageUserSearchDraftChange={storage.setStorageUserSearchDraft}
      onSaveDefault={storage.saveDefaultStorageBackend}
      onTestBackend={storage.testStorageBackend}
      onSearchStorageUsers={storage.searchStorageUsers}
      onClearStorageUserSearch={storage.clearStorageUserSearch}
      onSelectStorageUser={storage.selectStorageUserForStorage}
      onClearSelectedStorageUser={storage.clearSelectedStorageUserForStorage}
      onMigrateWorkspace={storage.migrateWorkspaceStorage}
    />
  );
}

function AdminPlatformContent(props: AdminSettingsTabContentProps) {
  const { activeTab, error, isSaving, platform } = props;
  if (activeTab === "processes") return <ProcessesTab />;
  if (activeTab === "statistics") return <StatisticsSettingsTab />;
  if (activeTab === "ai-providers") return <AiProvidersTab />;
  if (activeTab === "utilities") return <UtilitiesTab models={Object.keys(platform.settings?.modelMetadata ?? {})} />;
  if (activeTab === "model") {
    return (
      <ModelSettingsTab
        usageRateMultiplier={platform.usageRateMultiplier}
        modelMetadataDraft={platform.modelMetadataDraft}
        modelRoutersDraft={platform.modelRoutersDraft}
        modelSliderAgentIdsDraft={platform.modelSliderAgentIdsDraft}
        agentPresetsDraft={platform.agentPresetsDraft}
        specializedModelsDraft={platform.specializedModelsDraft}
        isSaving={isSaving}
        hasSettings={Boolean(platform.settings)}
        error={error}
        onUsageRateMultiplierChange={platform.setUsageRateMultiplier}
        onModelMetadataDraftChange={platform.setModelMetadataDraft}
        onModelRoutersDraftChange={platform.setModelRoutersDraft}
        onModelSliderAgentIdsDraftChange={platform.setModelSliderAgentIdsDraft}
        onAgentPresetsDraftChange={platform.setAgentPresetsDraft}
        onSpecializedModelsDraftChange={platform.setSpecializedModelsDraft}
        onSubmit={platform.saveSettings}
      />
    );
  }
  if (activeTab !== "settings") return null;

  return (
    <PlatformSettingsTab
      allowUserSignup={platform.allowUserSignup}
      requireAdminSignupApproval={platform.requireAdminSignupApproval}
      requireEmailVerificationOnSignup={platform.requireEmailVerificationOnSignup}
      enableForgotPassword={platform.enableForgotPassword}
      enablePromptCaching={platform.enablePromptCaching}
      debugMode={platform.debugMode}
      defaultFreeMessageLimit={platform.defaultFreeMessageLimit}
      maxTaskRunRetries={platform.maxTaskRunRetries}
      taskSchedulerDefaultEnvironmentConcurrency={platform.taskSchedulerDefaultEnvironmentConcurrency}
      taskSchedulerMaxWorkspaceConcurrency={platform.taskSchedulerMaxWorkspaceConcurrency}
      taskSchedulerMaxQueuedAheadPerWorkspace={platform.taskSchedulerMaxQueuedAheadPerWorkspace}
      taskSchedulerBackgroundAgingMinutes={platform.taskSchedulerBackgroundAgingMinutes}
      isSaving={isSaving}
      hasSettings={Boolean(platform.settings)}
      error={error}
      onAllowUserSignupChange={platform.setAllowUserSignup}
      onRequireAdminSignupApprovalChange={platform.setRequireAdminSignupApproval}
      onRequireEmailVerificationOnSignupChange={platform.setRequireEmailVerificationOnSignup}
      onEnableForgotPasswordChange={platform.setEnableForgotPassword}
      onEnablePromptCachingChange={platform.setEnablePromptCaching}
      onDebugModeChange={platform.setDebugMode}
      onDefaultFreeMessageLimitChange={platform.setDefaultFreeMessageLimit}
      onMaxTaskRunRetriesChange={platform.setMaxTaskRunRetries}
      onTaskSchedulerDefaultEnvironmentConcurrencyChange={platform.setTaskSchedulerDefaultEnvironmentConcurrency}
      onTaskSchedulerMaxWorkspaceConcurrencyChange={platform.setTaskSchedulerMaxWorkspaceConcurrency}
      onTaskSchedulerMaxQueuedAheadPerWorkspaceChange={platform.setTaskSchedulerMaxQueuedAheadPerWorkspace}
      onTaskSchedulerBackgroundAgingMinutesChange={platform.setTaskSchedulerBackgroundAgingMinutes}
      onSubmit={platform.saveSettings}
    />
  );
}

function AdminConnectorContent(props: AdminSettingsTabContentProps) {
  const { activeTab, error, isSaving, connectors } = props;
  if (activeTab === "sources") return <SourcesSettingsTab />;
  if (activeTab !== "connectors") return null;
  return (
    <ConnectorSettingsTab
      sharedConnectors={connectors.sharedConnectors}
      sharedDiscordEnabledDraft={connectors.sharedDiscordEnabledDraft}
      sharedDiscordTokenDraft={connectors.sharedDiscordTokenDraft}
      sharedTelegramEnabledDraft={connectors.sharedTelegramEnabledDraft}
      sharedTelegramTokenDraft={connectors.sharedTelegramTokenDraft}
      sharedTelegramIngestModeDraft={connectors.sharedTelegramIngestModeDraft}
      listmonkEnabledDraft={connectors.listmonkEnabledDraft}
      listmonkBaseUrlDraft={connectors.listmonkBaseUrlDraft}
      listmonkApiUsernameDraft={connectors.listmonkApiUsernameDraft}
      listmonkApiTokenDraft={connectors.listmonkApiTokenDraft}
      emailInboundEnabledDraft={connectors.emailInboundEnabledDraft}
      emailInboundDomainDraft={connectors.emailInboundDomainDraft}
      emailInboundAddressModeDraft={connectors.emailInboundAddressModeDraft}
      emailInboundDebugLoggingEnabledDraft={connectors.emailInboundDebugLoggingEnabledDraft}
      emailInboundWebhookSecretDraft={connectors.emailInboundWebhookSecretDraft}
      emailInboundBrevoApiKeyDraft={connectors.emailInboundBrevoApiKeyDraft}
      emailInboundWebhookEndpoint={connectors.emailInboundWebhookEndpoint}
      syncedBrevoWebhookUrl={connectors.syncedBrevoWebhookUrl}
      emailInboundWebhookEndpointPlaceholder={connectors.emailInboundWebhookEndpointPlaceholder}
      hasPendingEmailInboundSecretEdits={connectors.hasPendingEmailInboundSecretEdits}
      canSyncBrevoInboundWebhook={connectors.canSyncBrevoInboundWebhook}
      emailInboundDebugEvents={connectors.emailInboundDebugEvents}
      isSaving={isSaving}
      isSyncingBrevoWebhook={connectors.isSyncingBrevoWebhook}
      isRefreshingEmailInboundDebugEvents={connectors.isRefreshingEmailInboundDebugEvents}
      error={error}
      onSharedDiscordEnabledDraftChange={connectors.setSharedDiscordEnabledDraft}
      onSharedDiscordTokenDraftChange={connectors.setSharedDiscordTokenDraft}
      onSharedTelegramEnabledDraftChange={connectors.setSharedTelegramEnabledDraft}
      onSharedTelegramTokenDraftChange={connectors.setSharedTelegramTokenDraft}
      onSharedTelegramIngestModeDraftChange={connectors.setSharedTelegramIngestModeDraft}
      onListmonkEnabledDraftChange={connectors.setListmonkEnabledDraft}
      onListmonkBaseUrlDraftChange={connectors.setListmonkBaseUrlDraft}
      onListmonkApiUsernameDraftChange={connectors.setListmonkApiUsernameDraft}
      onListmonkApiTokenDraftChange={connectors.setListmonkApiTokenDraft}
      onEmailInboundEnabledDraftChange={connectors.setEmailInboundEnabledDraft}
      onEmailInboundDomainDraftChange={connectors.setEmailInboundDomainDraft}
      onEmailInboundAddressModeDraftChange={connectors.setEmailInboundAddressModeDraft}
      onEmailInboundDebugLoggingEnabledDraftChange={connectors.setEmailInboundDebugLoggingEnabledDraft}
      onEmailInboundWebhookSecretDraftChange={connectors.setEmailInboundWebhookSecretDraft}
      onEmailInboundBrevoApiKeyDraftChange={connectors.setEmailInboundBrevoApiKeyDraft}
      onSaveSharedDiscordSettings={connectors.saveSharedDiscordSettings}
      onSaveSharedTelegramSettings={connectors.saveSharedTelegramSettings}
      onSaveSharedListmonkSettings={connectors.saveSharedListmonkSettings}
      onSaveSharedEmailInboundSettings={connectors.saveSharedEmailInboundSettings}
      onSyncBrevoInboundWebhook={connectors.syncBrevoInboundWebhook}
      onCopyGeneratedEmailWebhookUrl={connectors.copyGeneratedEmailWebhookUrl}
      onReloadEmailInboundDebugEvents={connectors.reloadEmailInboundDebugEvents}
    />
  );
}

function AdminPublishingContent(props: AdminSettingsTabContentProps) {
  const { activeTab, error, publishing, platform } = props;
  if (activeTab === "users") return <UsersTab />;
  if (activeTab === "subscriptions") {
    return (
      <SubscriptionPlansTab
        plans={publishing.plans}
        agentPresets={platform.settings?.agentPresets ?? []}
        isPlanSaving={publishing.isPlanSaving}
        error={error}
        onCreatePlan={publishing.createPlan}
        onUpdatePlan={publishing.editPlan}
        onTogglePlanActive={publishing.togglePlanActive}
      />
    );
  }
  if (activeTab === "newsletter") {
    return (
      <NewsletterTab
        campaigns={publishing.campaigns}
        newsletterSubject={publishing.newsletterSubject}
        newsletterBodyFormat={publishing.newsletterBodyFormat}
        newsletterMarkdownBody={publishing.newsletterMarkdownBody}
        newsletterHtmlBody={publishing.newsletterHtmlBody}
        newsletterTrialRecipients={publishing.newsletterTrialRecipients}
        isNewsletterSending={publishing.isNewsletterSending}
        isNewsletterTrialSending={publishing.isNewsletterTrialSending}
        error={error}
        onNewsletterSubjectChange={publishing.setNewsletterSubject}
        onNewsletterBodyFormatChange={publishing.setNewsletterBodyFormat}
        onNewsletterMarkdownBodyChange={publishing.setNewsletterMarkdownBody}
        onNewsletterHtmlBodyChange={publishing.setNewsletterHtmlBody}
        onNewsletterTrialRecipientsChange={publishing.setNewsletterTrialRecipients}
        onSendNewsletter={publishing.sendNewsletter}
        onSendTrialNewsletter={publishing.sendTrialNewsletter}
        onRefreshHistory={publishing.reloadNewsletterCampaigns}
      />
    );
  }
  if (activeTab !== "announcements") return null;
  return (
    <AnnouncementsTab
      announcements={publishing.announcements}
      announcementTitle={publishing.announcementTitle}
      announcementBody={publishing.announcementBody}
      announcementNotify={publishing.announcementNotify}
      isAnnouncementSaving={publishing.isAnnouncementSaving}
      error={error}
      onAnnouncementTitleChange={publishing.setAnnouncementTitle}
      onAnnouncementBodyChange={publishing.setAnnouncementBody}
      onAnnouncementNotifyChange={publishing.setAnnouncementNotify}
      onCreateAnnouncement={publishing.createAnnouncement}
      onDeleteAnnouncement={publishing.deleteAnnouncement}
    />
  );
}

export function AdminSettingsTabContent(props: AdminSettingsTabContentProps) {
  return (
    <>
      <AdminStorageAndMigrationContent {...props} />
      <AdminPlatformContent {...props} />
      <AdminConnectorContent {...props} />
      <AdminPublishingContent {...props} />
    </>
  );
}
