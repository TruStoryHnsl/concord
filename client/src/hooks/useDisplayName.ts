import { useMemo } from "react";
import { useServerStore } from "../stores/server";

/**
 * Returns the display name for a user in the currently active server context.
 * Priority: server display name > stripped user ID (e.g., "@alice:host" → "alice")
 */
export function useDisplayName(userId: string): string {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const members = useServerStore((s) => s.members);

  return useMemo(() => {
    if (activeServerId) {
      const serverMembers = members[activeServerId];
      if (serverMembers) {
        const member = serverMembers.find((m) => m.user_id === userId);
        if (member?.display_name) return member.display_name;
      }
    }
    return userId.split(":")[0].replace("@", "");
  }, [userId, activeServerId, members]);
}

/**
 * Batch version: returns a map of userId → display name for all given IDs.
 */
export function useDisplayNames(userIds: string[]): Record<string, string> {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const members = useServerStore((s) => s.members);

  return useMemo(() => {
    const result: Record<string, string> = {};
    const serverMembers = activeServerId ? members[activeServerId] : undefined;

    for (const userId of userIds) {
      if (serverMembers) {
        const member = serverMembers.find((m) => m.user_id === userId);
        if (member?.display_name) {
          result[userId] = member.display_name;
          continue;
        }
      }
      result[userId] = userId.split(":")[0].replace("@", "");
    }
    return result;
  }, [userIds, activeServerId, members]);
}
