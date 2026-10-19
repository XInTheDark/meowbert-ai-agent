import { useState } from "react";
import type { WastedTurnsReport } from "@meowbert/shared/wasted-turns";
import { useWorkspaceApp } from "../../../../contexts/WorkspaceContext";

export function useWastedTurnsReport() {
  const { api } = useWorkspaceApp();
  const [report, setReport] = useState<WastedTurnsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze(target: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await api.post<{ report: WastedTurnsReport }>("/api/admin/debug/wasted-turns", { target });
      setReport(response.report);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return { report, loading, error, analyze };
}
