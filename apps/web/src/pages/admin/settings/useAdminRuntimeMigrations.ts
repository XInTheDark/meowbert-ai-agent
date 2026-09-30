import { useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { FlashMessage } from "../../../lib/types";
import { buildAdminRuntimeMigrationConfirmationMessage } from "./adminSettingsDrafts";
import type {
  AdminRuntimeMigrationRunResponse,
  AdminRuntimeMigrationSummary,
  AdminRuntimeMigrationsResponse
} from "./shared";

interface UseAdminRuntimeMigrationsInput {
  api: ApiClient;
  setError: (error: string | null) => void;
  setFlash: (flash: FlashMessage | null) => void;
}

export function useAdminRuntimeMigrations(input: UseAdminRuntimeMigrationsInput) {
  const { api, setError, setFlash } = input;
  const [adminRuntimeMigrations, setAdminRuntimeMigrations] = useState<AdminRuntimeMigrationSummary[]>([]);
  const [runningAdminMigrationKey, setRunningAdminMigrationKey] = useState<string | null>(null);

  async function reloadAdminRuntimeMigrations(): Promise<void> {
    const response = await api.get<AdminRuntimeMigrationsResponse>("/api/admin/migrations");
    setAdminRuntimeMigrations(response.migrations);
  }

  async function runAdminRuntimeMigration(migrationKey: AdminRuntimeMigrationSummary["key"]): Promise<void> {
    const migration = adminRuntimeMigrations.find((entry) => entry.key === migrationKey);
    if (!migration) {
      setError("Migration not found.");
      return;
    }
    if (!window.confirm(buildAdminRuntimeMigrationConfirmationMessage(migration))) {
      return;
    }

    setError(null);
    setRunningAdminMigrationKey(migrationKey);
    try {
      await api.post<AdminRuntimeMigrationRunResponse>(`/api/admin/migrations/${migrationKey}/run`);
      await reloadAdminRuntimeMigrations();
      setFlash({ tone: "success", text: "Admin migration queued." });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunningAdminMigrationKey(null);
    }
  }

  return {
    adminRuntimeMigrations,
    setAdminRuntimeMigrations,
    runningAdminMigrationKey,
    runAdminRuntimeMigration
  };
}
