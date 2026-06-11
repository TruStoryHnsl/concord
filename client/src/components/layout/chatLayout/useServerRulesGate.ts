import { useEffect, useState } from "react";
import { getServerRules } from "../../../api/concord";

/** localStorage key for tracking rules acceptance per server per user. */
export function rulesAcceptedKey(userId: string, serverId: string) {
  return `concord_rules_accepted:${userId}:${serverId}`;
}

export interface ServerRulesGate {
  activeServerRulesText: string | null;
  rulesAccepted: boolean;
  setRulesAccepted: (accepted: boolean) => void;
}

/**
 * Rules gate state — tracks rules_text for the active server and whether
 * the current user has accepted it. Acceptance is persisted in
 * localStorage keyed by (userId, serverId) so it survives page reloads.
 *
 * Extracted verbatim from ChatLayout, including its original dependency
 * list (intentionally excluding `activeServerRulesText` source / the
 * store rules object — the exhaustive-deps lint is suppressed exactly as
 * before to preserve fetch timing).
 */
export function useServerRulesGate(
  activeServerId: string | null | undefined,
  userId: string | null,
  accessToken: string | null,
  dmActive: boolean,
  storedRulesText: string | null | undefined,
): ServerRulesGate {
  const [activeServerRulesText, setActiveServerRulesText] = useState<string | null>(null);
  const [rulesAccepted, setRulesAccepted] = useState<boolean>(true);

  useEffect(() => {
    if (!activeServerId || !userId || !accessToken || dmActive) {
      setActiveServerRulesText(null);
      setRulesAccepted(true);
      return;
    }
    // Use rules_text already in the store if present; otherwise fetch.
    const resolve = (rulesText: string | null | undefined) => {
      if (!rulesText) {
        setActiveServerRulesText(null);
        setRulesAccepted(true);
        return;
      }
      setActiveServerRulesText(rulesText);
      const accepted = localStorage.getItem(rulesAcceptedKey(userId, activeServerId)) === "1";
      setRulesAccepted(accepted);
    };
    if (storedRulesText !== undefined) {
      resolve(storedRulesText);
    } else {
      getServerRules(activeServerId, accessToken)
        .then((data) => resolve(data.rules_text))
        .catch(() => resolve(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId, userId, accessToken, dmActive]);

  return { activeServerRulesText, rulesAccepted, setRulesAccepted };
}
