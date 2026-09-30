import { useCallback, useEffect, useState } from "react";
import type { AdminAiProvider } from "@meowbert/shared";
import type { ApiClient } from "../../lib/api";
import type { UserProfile } from "../../lib/types";

const DISMISSED_KEY_PREFIX = "meowbert_admin_setup_dismissed_v1:";

function readDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(`${DISMISSED_KEY_PREFIX}${userId}`) === "1";
  } catch {
    return false;
  }
}

// Shows the admin setup wizard to super admins until the platform has an AI provider.
export function useAdminSetupStatus(api: ApiClient, user: UserProfile | null) {
  const [needsSetup, setNeedsSetup] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const userId = user?.id ?? null;
  const isSuperAdmin = user?.is_super_admin === true;

  useEffect(() => {
    if (!userId || !isSuperAdmin || readDismissed(userId)) {
      setNeedsSetup(false);
      setIsChecking(false);
      return;
    }

    let cancelled = false;
    setIsChecking(true);
    api.get<{ providers: AdminAiProvider[] }>("/api/admin/ai-providers")
      .then((response) => { if (!cancelled) setNeedsSetup(response.providers.length === 0); })
      .catch(() => { if (!cancelled) setNeedsSetup(false); })
      .finally(() => { if (!cancelled) setIsChecking(false); });
    return () => { cancelled = true; };
  }, [api, isSuperAdmin, userId]);

  const dismiss = useCallback(() => {
    if (userId) {
      try {
        window.localStorage.setItem(`${DISMISSED_KEY_PREFIX}${userId}`, "1");
      } catch {
        // Storage can be unavailable; the wizard simply shows again next time.
      }
    }
    setNeedsSetup(false);
  }, [userId]);

  const complete = useCallback(() => setNeedsSetup(false), []);

  return { needsSetup, isChecking, dismiss, complete };
}
