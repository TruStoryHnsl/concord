import { useMemo } from "react";
import { useAuthStore } from "../stores/auth";

/**
 * Returns the local server name derived from the current user's Matrix ID.
 * e.g., "@alice:chat.example.com" → "chat.example.com"
 */
export function useLocalServerName(): string {
  const userId = useAuthStore((s) => s.userId);
  return useMemo(() => {
    if (!userId) return "";
    const parts = userId.split(":");
    return parts.length > 1 ? parts.slice(1).join(":") : "";
  }, [userId]);
}

/**
 * Returns true if the given Matrix user ID belongs to a remote (federated) server.
 */
export function useIsRemoteUser(userId: string): boolean {
  const localServer = useLocalServerName();
  return useMemo(() => {
    if (!localServer || !userId) return false;
    const userServer = userId.split(":").slice(1).join(":");
    return userServer !== localServer;
  }, [userId, localServer]);
}

/**
 * Extracts the server name from a Matrix user ID.
 */
export function getServerFromUserId(userId: string): string {
  const parts = userId.split(":");
  return parts.length > 1 ? parts.slice(1).join(":") : "";
}

/**
 * Returns true if the userId belongs to a different server than localServer.
 */
export function isRemoteUser(userId: string, localServer: string): boolean {
  if (!localServer || !userId) return false;
  return getServerFromUserId(userId) !== localServer;
}
