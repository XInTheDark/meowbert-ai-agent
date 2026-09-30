import { useCallback, useEffect, useState } from "react";
import type { AdminAiProvider, AiProviderConfig } from "@meowbert/shared";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";

interface ProvidersResponse {
  providers: AdminAiProvider[];
}

export function useAdminAiProviders() {
  const { api } = useWorkspaceApp();
  const [providers, setProviders] = useState<AdminAiProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<ProvidersResponse>("/api/admin/ai-providers");
      setProviders(response.providers);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);

  async function save(request: () => Promise<ProvidersResponse>): Promise<boolean> {
    setIsSaving(true);
    setError(null);
    try {
      const response = await request();
      setProviders(response.providers);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return {
    providers, isLoading, isSaving, error, reload,
    addProvider: (provider: AiProviderConfig) => save(() => api.post<ProvidersResponse>("/api/admin/ai-providers", provider)),
    selectProvider: (id: string) => save(() => api.post<ProvidersResponse>(`/api/admin/ai-providers/${id}/select`)),
    removeProvider: (id: string) => save(() => api.delete<ProvidersResponse>(`/api/admin/ai-providers/${id}`))
  };
}
