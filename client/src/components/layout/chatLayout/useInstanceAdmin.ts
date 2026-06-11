import { useEffect, useState } from "react";

/**
 * INS-070 — resolve whether the current session is an instance admin.
 *
 * Extracted verbatim from ChatLayout. Gates the admin-only Extension
 * Library menu entry. Returns false while unauthenticated or on any
 * lookup failure (fail-closed). The async checkAdmin import is lazy so
 * the admin API module isn't pulled into the initial bundle.
 */
export function useInstanceAdmin(accessToken: string | null): boolean {
  const [isInstanceAdmin, setIsInstanceAdmin] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      setIsInstanceAdmin(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { checkAdmin } = await import("../../../api/concord");
        const result = await checkAdmin(accessToken);
        if (!cancelled) setIsInstanceAdmin(result.is_admin);
      } catch {
        if (!cancelled) setIsInstanceAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  return isInstanceAdmin;
}
