import { useCallback, useEffect, useState } from "react";
import type {
  AdminAntigravityCredential,
  AntigravityCredentialModelsResult,
  AntigravityCredentialUsageResult,
  AntigravityLoginStartResult
} from "@meowbert/shared";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";

interface CredentialsResponse {
  credentials: AdminAntigravityCredential[];
}

export function useAdminAntigravity() {
  const { api } = useWorkspaceApp();
  const [credentials, setCredentials] = useState<AdminAntigravityCredential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingLogin, setPendingLogin] = useState<AntigravityLoginStartResult | null>(null);
  const [modelsById, setModelsById] = useState<Record<string, AntigravityCredentialModelsResult>>({});
  const [usageById, setUsageById] = useState<Record<string, AntigravityCredentialUsageResult>>({});

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<CredentialsResponse>("/api/admin/antigravity/credentials");
      setCredentials(response.credentials);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);

  async function runCredentialsMutation(request: () => Promise<CredentialsResponse>): Promise<boolean> {
    setIsBusy(true);
    setError(null);
    try {
      const response = await request();
      setCredentials(response.credentials);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function startLogin(label?: string): Promise<boolean> {
    setIsBusy(true);
    setError(null);
    try {
      const started = await api.post<AntigravityLoginStartResult>("/api/admin/antigravity/login/start", {
        ...(label?.trim() ? { label: label.trim() } : {})
      });
      setPendingLogin(started);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function completeLogin(codeOrCallbackUrl: string): Promise<boolean> {
    if (!pendingLogin) return false;
    const ok = await runCredentialsMutation(() =>
      api.post<CredentialsResponse>("/api/admin/antigravity/login/complete", {
        loginSessionId: pendingLogin.loginSessionId,
        codeOrCallbackUrl
      })
    );
    if (ok) setPendingLogin(null);
    return ok;
  }

  async function cancelLogin(): Promise<void> {
    const current = pendingLogin;
    setPendingLogin(null);
    if (!current) return;
    await api.post("/api/admin/antigravity/login/cancel", { loginSessionId: current.loginSessionId }).catch(() => undefined);
  }

  async function loadModels(credentialId: string): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      const result = await api.get<AntigravityCredentialModelsResult>(`/api/admin/antigravity/credentials/${credentialId}/models`);
      setModelsById((prev) => ({ ...prev, [credentialId]: result }));
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsBusy(false);
    }
  }

  async function loadUsage(credentialId: string): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      const result = await api.get<AntigravityCredentialUsageResult>(`/api/admin/antigravity/credentials/${credentialId}/usage`);
      setUsageById((prev) => ({ ...prev, [credentialId]: result }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsBusy(false);
    }
  }

  return {
    credentials,
    isLoading,
    isBusy,
    error,
    pendingLogin,
    modelsById,
    usageById,
    reload,
    startLogin,
    completeLogin,
    cancelLogin,
    selectCredential: (id: string) => runCredentialsMutation(() => api.post<CredentialsResponse>(`/api/admin/antigravity/credentials/${id}/select`)),
    removeCredential: (id: string) => runCredentialsMutation(() => api.delete<CredentialsResponse>(`/api/admin/antigravity/credentials/${id}`)),
    loadModels,
    loadUsage
  };
}
