import { useEffect, useState } from "react";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import type { DesktopLocalExecutionSettings, DesktopLocalExecutionStatus } from "../../desktop/platform";

export function useLocalExecutionPreferences() {
  const { platform, activeServerProfile } = useAppRuntime();
  const [settings, setSettings] = useState<DesktopLocalExecutionSettings | null>(null);
  const [status, setStatus] = useState<DesktopLocalExecutionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void platform.getBootstrapData().then((data) => {
      if (!cancelled) setSettings(data.localExecutionSettings);
    }).catch((err) => { if (!cancelled) setError(String(err)); });
    const refresh = () => void platform.getLocalExecutionStatus().then((value) => {
      if (!cancelled) setStatus(value);
    }).catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, 2_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [platform, activeServerProfile?.baseUrl]);

  function updateSettings(patch: Partial<DesktopLocalExecutionSettings>) {
    setSettings((current) => current ? { ...current, ...patch } : null);
    setSaved(false);
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setSettings(await platform.saveLocalExecutionSettings(settings));
      setStatus(await platform.getLocalExecutionStatus());
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function pickRoot() {
    setError(null);
    try {
      const storageRoot = await platform.pickLocalExecutionStorageRoot();
      if (storageRoot) updateSettings({ storageRoot });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await platform.retryLocalExecution());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return { settings, status, busy, error, saved, updateSettings, save, pickRoot, retry };
}
