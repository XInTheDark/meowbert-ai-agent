import { useState } from "react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { AdminSettingsTabBar } from "./settings/AdminSettingsTabBar";
import { AdminSettingsTabContent } from "./settings/AdminSettingsTabContent";
import { useAdminConnectorSettings } from "./settings/useAdminConnectorSettings";
import { useAdminHostStorageSettings } from "./settings/useAdminHostStorageSettings";
import { useAdminPlatformSettings } from "./settings/useAdminPlatformSettings";
import { useAdminPublishingSettings } from "./settings/useAdminPublishingSettings";
import { useAdminRuntimeMigrations } from "./settings/useAdminRuntimeMigrations";
import { useAdminStorageSettings } from "./settings/useAdminStorageSettings";
import { useAdminSettingsInitialLoad } from "./settings/useAdminSettingsInitialLoad";
import type { AdminSettingsTabKey } from "./settings/shared";


export function AdminSettingsPage() {
  const { api, user, setFlash } = useWorkspaceApp();
  const [activeTab, setActiveTab] = useState<AdminSettingsTabKey>("settings");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const platformSettings = useAdminPlatformSettings({ api, setError, setFlash, setIsSaving });
  const storageSettings = useAdminStorageSettings({
    api,
    activeTab,
    isSuperAdmin: user?.is_super_admin === true,
    setError,
    setFlash
  });
  const hostStorageSettings = useAdminHostStorageSettings({
    api,
    activeTab,
    isSuperAdmin: user?.is_super_admin === true,
    setError,
    setFlash
  });
  const connectorSettings = useAdminConnectorSettings({ api, setError, setFlash, setIsSaving });
  const publishingSettings = useAdminPublishingSettings({ api, setError, setFlash });
  const runtimeMigrations = useAdminRuntimeMigrations({ api, setError, setFlash });



  useAdminSettingsInitialLoad({
    api,
    isSuperAdmin: user?.is_super_admin === true,
    setError,
    setIsLoading,
    platform: platformSettings,
    storage: storageSettings,
    connectors: connectorSettings,
    publishing: publishingSettings,
    migrations: runtimeMigrations
  });

  if (!user?.is_super_admin) {
    return (
      <section className="page-content settings-page">
        <article className="section-card empty-card">
          <h3>Admin panel unavailable</h3>
          <p>You need super admin access to view platform settings.</p>
        </article>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="page-content settings-page">
        <article className="section-card empty-card">
          <h3>Loading admin settings...</h3>
        </article>
      </section>
    );
  }

  return (
    <section className="page-content settings-page">
      <article className="section-card" style={{ minWidth: 0 }}>
        <div className="section-head">
          <div>
            <h3>Admin Panel</h3>
            <p className="muted-text">Platform-level controls for user access, model behavior, quotas, and subscriptions.</p>
          </div>
        </div>

        <AdminSettingsTabBar activeTab={activeTab} onTabChange={setActiveTab} />

        <AdminSettingsTabContent
          activeTab={activeTab}
          error={error}
          isSaving={isSaving}
          platform={platformSettings}
          hostStorage={hostStorageSettings}
          storage={storageSettings}
          connectors={connectorSettings}
          publishing={publishingSettings}
          migrations={runtimeMigrations}
        />
      </article>
    </section>
  );
}
