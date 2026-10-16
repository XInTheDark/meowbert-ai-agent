import { useCallback, useEffect, useState } from "react";
import type {
  AdminAiProvider,
  AdminMemoryEmbeddingSettings,
  MemoryEmbeddingSettingsInput,
  MemoryReindexJob
} from "@meowbert/shared";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";

const JOB_POLL_INTERVAL_MS = 2_000;

interface EmbeddingsResponse {
  settings: AdminMemoryEmbeddingSettings;
  providers: AdminAiProvider[];
  job: MemoryReindexJob | null;
}

export function isReindexActive(job: MemoryReindexJob | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

export function useAdminMemoryEmbeddings() {
  const { api } = useWorkspaceApp();
  const [settings, setSettings] = useState<AdminMemoryEmbeddingSettings | null>(null);
  const [providers, setProviders] = useState<AdminAiProvider[]>([]);
  const [job, setJob] = useState<MemoryReindexJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<EmbeddingsResponse>("/api/admin/memory-embeddings");
      setSettings(response.settings);
      setProviders(response.providers);
      setJob(response.job);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);

  const jobActive = isReindexActive(job);
  useEffect(() => {
    if (!jobActive) {
      return;
    }
    const timer = window.setInterval(() => {
      void api.get<{ job: MemoryReindexJob | null }>("/api/admin/memory-embeddings/reindex")
        .then((response) => setJob(response.job))
        .catch(() => undefined);
    }, JOB_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [api, jobActive]);

  async function run(request: () => Promise<void>): Promise<boolean> {
    setIsSaving(true);
    setError(null);
    try {
      await request();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return {
    settings, providers, job, isLoading, isSaving, error, reload,
    saveSettings: (input: MemoryEmbeddingSettingsInput) => run(async () => {
      const response = await api.put<{ settings: AdminMemoryEmbeddingSettings }>("/api/admin/memory-embeddings", input);
      setSettings(response.settings);
    }),
    reembedLazily: () => run(async () => {
      const response = await api.post<{ settings: AdminMemoryEmbeddingSettings }>("/api/admin/memory-embeddings/reembed");
      setSettings(response.settings);
    }),
    startReindex: (concurrency: number) => run(async () => {
      const response = await api.post<{ job: MemoryReindexJob }>("/api/admin/memory-embeddings/reindex", { concurrency });
      setJob(response.job);
      const refreshed = await api.get<EmbeddingsResponse>("/api/admin/memory-embeddings");
      setSettings(refreshed.settings);
    }),
    cancelReindex: () => run(async () => {
      const response = await api.post<{ job: MemoryReindexJob | null }>("/api/admin/memory-embeddings/reindex/cancel");
      setJob(response.job);
    })
  };
}
