import { useCallback, useEffect, useState } from "react";
import type { AdminAiProvider, UsageActivationInput, UsageActivationSchedule } from "@meowbert/shared";
import { useWorkspaceApp } from "../../../../contexts/WorkspaceContext";

const path = "/api/admin/utilities/usage-activation";

export function useUsageActivation() {
  const { api } = useWorkspaceApp();
  const [schedules, setSchedules] = useState<UsageActivationSchedule[]>([]);
  const [providers, setProviders] = useState<AdminAiProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [data, providerData] = await Promise.all([
        api.get<{ schedules: UsageActivationSchedule[] }>(path),
        api.get<{ providers: AdminAiProvider[] }>("/api/admin/ai-providers")
      ]);
      setSchedules(data.schedules);
      setProviders(providerData.providers);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => { void reload(); }, [reload]);

  async function save(input: UsageActivationInput, id?: string): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const response = id
        ? await api.patch<{ schedule: UsageActivationSchedule }>(`${path}/${id}`, input)
        : await api.post<{ schedule: UsageActivationSchedule }>(path, input);
      setSchedules((previous) => id
        ? previous.map((item) => item.id === id ? response.schedule : item)
        : [...previous, response.schedule]);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return false;
    } finally { setSaving(false); }
  }

  async function remove(id: string): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await api.delete(`${path}/${id}`);
      setSchedules((previous) => previous.filter((item) => item.id !== id));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally { setSaving(false); }
  }

  return { schedules, providers, loading, saving, error, reload, save, remove };
}
