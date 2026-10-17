import { useCallback, useEffect, useRef, useState } from "react";
import { fetchProjectCanvasPreviewTicket } from "../../lib/projectCanvases";

// Preview tickets last eight hours; renew well before that for pages opened later.
const TICKET_RENEW_MS = 6 * 60 * 60 * 1000;

/** Preview tickets for project canvases, fetched the first time each canvas is shown. */
export function useProjectCanvasTickets(projectId: string | null, token: string | null) {
  const [tickets, setTickets] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    requested.current.clear();
    setTickets({});
    const timer = window.setInterval(() => {
      requested.current.clear();
      setTickets({});
    }, TICKET_RENEW_MS);
    return () => window.clearInterval(timer);
  }, [projectId, token]);

  return useCallback((canvasId: string): string | null => {
    const ticket = tickets[canvasId];
    if (ticket || !projectId || !token || requested.current.has(canvasId)) return ticket ?? null;
    requested.current.add(canvasId);
    void fetchProjectCanvasPreviewTicket(projectId, canvasId, token)
      .then((response) => setTickets((current) => ({ ...current, [canvasId]: response.ticket })))
      .catch(() => requested.current.delete(canvasId));
    return null;
  }, [projectId, tickets, token]);
}
